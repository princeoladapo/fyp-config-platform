// Works out which of the three rule kinds in Section 3.6.6 a condition belongs to.
// The seed script uses this to fill the `kind` column, and the rule repository
// uses it to check that the stored kind still agrees with the stored condition.

import { RuleKind } from '../../generated/prisma/client';

// "production >= staging": an environment name, an operator, an environment name.
const RELATIONSHIP_PATTERN = /^(\w+)\s*(>=|<=|==|!=|>|<)\s*(\w+)$/;
// ">= 3", "== true" or "startsWith(registry.example.com/)".
const FIXED_PATTERN = /^(>=|<=|==|!=|>|<)\s*\S.*$|^startsWith\(.+\)$/;

export function ruleKindOf(condition: string): RuleKind | null {
  const c = condition.trim();
  if (c === 'same') return RuleKind.SAME_VALUE;
  if (RELATIONSHIP_PATTERN.test(c)) return RuleKind.RELATIONSHIP;
  if (FIXED_PATTERN.test(c)) return RuleKind.FIXED_CONDITION;
  return null;
}

// The two environment names in a relationship condition, or null.
export function relationshipEnvironments(condition: string): [string, string] | null {
  const m = condition.trim().match(RELATIONSHIP_PATTERN);
  if (!m || m[1] === undefined || m[3] === undefined) return null;
  return [m[1], m[3]];
}
