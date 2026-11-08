// Loads validation rules from the database (increment four) and returns them in the
// RuleDefinition shape the rules engine already uses. Each rule is checked first;
// if any rule is invalid, loading fails with an error naming every invalid rule.

import { PrismaClient, Rule, RuleKind } from '../../generated/prisma/client';
import { RuleDefinition, Severity } from '../engine/types';
import { relationshipEnvironments, ruleKindOf } from './ruleKind';

// Agreed scope: only these three resource kinds are read from Git and Kubernetes.
export const KNOWN_RESOURCE_KINDS = ['Deployment', 'Service', 'ConfigMap'];

// Returns the problems with one rule; an empty list means the rule is valid.
export function checkRule(rule: Rule, knownEnvironments: Set<string>): string[] {
  const problems: string[] = [];

  if (!KNOWN_RESOURCE_KINDS.includes(rule.resource)) {
    problems.push(`unknown resource kind "${rule.resource}" (expected ${KNOWN_RESOURCE_KINDS.join(', ')})`);
  }

  const kindFromCondition = ruleKindOf(rule.condition);
  if (!kindFromCondition) {
    problems.push(`unrecognised condition "${rule.condition}"`);
  } else if (kindFromCondition !== rule.kind) {
    problems.push(`kind is ${rule.kind} but condition "${rule.condition}" is a ${kindFromCondition} condition`);
  }

  for (const env of rule.environments) {
    if (!knownEnvironments.has(env)) problems.push(`environment "${env}" is not in the environments table`);
  }

  if (rule.kind === RuleKind.RELATIONSHIP) {
    const pair = relationshipEnvironments(rule.condition);
    if (!pair) {
      problems.push(`a RELATIONSHIP rule must compare two environments, e.g. "production >= staging"`);
    } else {
      const [left, right] = pair;
      if (left === right) problems.push(`a RELATIONSHIP rule must name two different environments`);
      for (const env of new Set(pair)) {
        if (!knownEnvironments.has(env)) problems.push(`environment "${env}" in the condition is not in the environments table`);
      }
    }
  }

  if (rule.kind === RuleKind.SAME_VALUE && rule.environments.length === 1) {
    problems.push(`a SAME_VALUE rule needs at least two environments (or none, meaning all)`);
  }

  return problems;
}

function toRuleDefinition(rule: Rule): RuleDefinition {
  const definition: RuleDefinition = {
    rule: rule.name,
    resource: rule.resource,
    property: rule.property,
    condition: rule.condition,
    severity: rule.severity.toLowerCase() as Severity,
  };
  // An empty list means "not set": the engine then uses every environment.
  if (rule.environments.length > 0) definition.environments = [...rule.environments];
  return definition;
}

export async function loadEnabledRules(prisma: PrismaClient): Promise<RuleDefinition[]> {
  const [rules, environments] = await Promise.all([
    prisma.rule.findMany({ where: { enabled: true }, orderBy: { id: 'asc' } }),
    prisma.environment.findMany({ select: { name: true } }),
  ]);
  const knownEnvironments = new Set(environments.map((e) => e.name));

  const errors = rules.flatMap((rule) =>
    checkRule(rule, knownEnvironments).map((problem) => `  - rule "${rule.name}": ${problem}`),
  );
  if (errors.length > 0) {
    throw new Error(`Invalid rules in the database:\n${errors.join('\n')}`);
  }

  return rules.map(toRuleDefinition);
}
