import {
  NormalizedRecord,
  RuleDefinition,
  EngineFinding,
  Representation,
} from './types';

const REPRESENTATIONS: Representation[] = ['declared', 'live'];
const OPERATORS = ['>=', '<=', '==', '!=', '>', '<'] as const;
type Operator = (typeof OPERATORS)[number];

// ---------- small helpers ----------

// Turns a rule path like "spec.template.spec.containers[*].image"
// into a pattern that matches "spec.template.spec.containers[0].image",
// "...containers[1].image", and so on.
function propertyMatches(pattern: string, actual: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|\\]/g, '\\$&')
    .replace(/\[\*\]/g, '\\[\\d+\\]')
    .replace(/\[(\d+)\]/g, '\\[$1\\]');
  return new RegExp(`^${escaped}$`).test(actual);
}

function compare(a: unknown, op: Operator, b: unknown): boolean {
  const na = Number(a);
  const nb = Number(b);
  const numeric = a !== '' && b !== '' && !isNaN(na) && !isNaN(nb);
  const x = numeric ? na : String(a);
  const y = numeric ? nb : String(b);
  switch (op) {
    case '>=': return x >= y;
    case '<=': return x <= y;
    case '>':  return x > y;
    case '<':  return x < y;
    case '==': return x === y;
    case '!=': return x !== y;
  }
}

// Checks a fixed condition such as ">= 3", "== true" or
// "startsWith(registry.example.com/)" against one value.
function checkFixed(condition: string, value: unknown): boolean {
  const starts = condition.match(/^startsWith\((.*)\)$/);
  if (starts) return String(value).startsWith(starts[1]);

  for (const op of OPERATORS) {
    if (condition.startsWith(op)) {
      const target = condition.slice(op.length).trim();
      return compare(value, op, target);
    }
  }
  throw new Error(`Unrecognised condition: "${condition}"`);
}

// Recognises relational conditions such as "production >= staging".
function parseRelational(condition: string, environments: string[]) {
  const m = condition.match(/^(\w+)\s*(>=|<=|==|!=|>|<)\s*(\w+)$/);
  if (!m) return null;
  const [, left, op, right] = m;
  if (!environments.includes(left) || !environments.includes(right)) return null;
  return { left, op: op as Operator, right };
}

// ---------- the engine ----------

export function evaluate(
  records: NormalizedRecord[],
  rules: RuleDefinition[],
  environments: string[],
): EngineFinding[] {
  const findings: EngineFinding[] = [];

  for (const rule of rules) {
    const relational = parseRelational(rule.condition, environments);
    const scope = rule.environments ?? environments;

    for (const rep of REPRESENTATIONS) {
      const recs = records.filter(
        (r) => r.representation === rep && r.kind === rule.resource,
      );
      const names = [...new Set(recs.map((r) => r.name))];

      // Was this representation collected at all for an environment?
      const collected = (env: string) =>
        records.some((r) => r.environment === env && r.representation === rep);
      // Does this particular resource exist in an environment?
      const exists = (env: string, name: string) =>
        recs.some((r) => r.environment === env && r.name === name);
      // All values of the rule's property for one resource in one environment.
      const valuesIn = (env: string, name: string) =>
        recs.filter(
          (r) => r.environment === env && r.name === name &&
                 propertyMatches(rule.property, r.property),
        );

      const report = (env: string, name: string, property: string,
                      expected: string, observed: string) =>
        findings.push({
          rule: rule.rule, environment: env, representation: rep,
          kind: rule.resource, name, property, expected, observed,
          severity: rule.severity,
        });

      for (const name of names) {
        // Kind 1: relationship between two environments.
        if (relational) {
          const { left, op, right } = relational;
          if (!exists(left, name) || !exists(right, name)) continue;
          const L = valuesIn(left, name);
          const R = valuesIn(right, name);
          if (L.length === 0 || R.length === 0) {
            const missing = L.length === 0 ? left : right;
            report(missing, name, rule.property, rule.condition, 'absent');
            continue;
          }
          for (const l of L) {
            const r = R.find((x) => x.property === l.property);
            if (!r) continue;
            if (!compare(l.value, op, r.value)) {
              report(left, name, l.property, rule.condition,
                     `${left}=${l.value}, ${right}=${r.value}`);
            }
          }
          continue;
        }

        // Kind 2: value must be the same across the listed environments.
        if (rule.condition === 'same') {
          const envs = scope.filter(collected);
          if (!envs.some((e) => exists(e, name))) continue;
          const props = new Set(
            envs.flatMap((e) => valuesIn(e, name).map((r) => r.property)),
          );
          if (props.size === 0) props.add(rule.property);

          for (const prop of props) {
            const vals = envs.map((e) => {
              const hit = valuesIn(e, name).find((r) => r.property === prop);
              return { env: e, value: hit ? String(hit.value) : 'absent' };
            });
            // The most common value is taken as the expected one;
            // in a tie, the first environment listed in the rule wins.
            const counts = new Map<string, number>();
            vals.forEach((v) => counts.set(v.value, (counts.get(v.value) ?? 0) + 1));
            const expected = [...counts.entries()]
              .sort((a, b) => b[1] - a[1])[0][0];
            for (const v of vals) {
              if (v.value !== expected) {
                report(v.env, name, prop, `same as other environments (${expected})`, v.value);
              }
            }
          }
          continue;
        }

        // Kind 3: fixed condition in each listed environment.
        for (const env of scope) {
          if (!exists(env, name)) continue;
          const vals = valuesIn(env, name);
          if (vals.length === 0) {
            report(env, name, rule.property, rule.condition, 'absent');
            continue;
          }
          for (const v of vals) {
            if (!checkFixed(rule.condition, v.value)) {
              report(env, name, v.property, rule.condition, String(v.value));
            }
          }
        }
      }
    }
  }

  return findings;
}
