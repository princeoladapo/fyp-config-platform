// Shapes the reporting API returns (increment 5b). Database rows are mapped here so the
// routes stay short and the dashboard sees one stable JSON shape. Dates are sent as ISO
// strings (JSON.stringify does that), severities and statuses as the database enum names.

import { Environment, Finding, Rule, Severity, ValidationRun } from '../../generated/prisma/client';

export interface SeverityCounts {
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

export interface RunSummaryView {
  id: number;
  startedAt: Date;
  completedAt: Date | null;
  status: ValidationRun['status'];
  durationMs: number | null;
  gitRef: string;
  gitCommit: string | null;
  kubeContext: string | null;
  rulesChecked: number | null;
  declaredRecordCount: number | null;
  liveRecordCount: number | null;
  findingCount: number | null;
  findingsBySeverity: SeverityCounts;
  warningCount: number;
  errorMessage: string | null;
}

export interface FindingView {
  id: number;
  rule: string;
  environment: string;
  representation: Finding['representation'];
  kind: string;
  name: string;
  property: string;
  expected: string;
  observed: string;
  severity: Severity;
}

export interface RunDetailView extends RunSummaryView {
  warnings: string[];
  findings: FindingView[];
}

export type FindingWithNames = Finding & { rule: { name: string }; environment: { name: string } };

export function emptySeverityCounts(): SeverityCounts {
  return { HIGH: 0, MEDIUM: 0, LOW: 0 };
}

export function runSummaryView(run: ValidationRun, findingsBySeverity: SeverityCounts): RunSummaryView {
  return {
    id: run.id,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    durationMs: run.durationMs,
    gitRef: run.gitRef,
    gitCommit: run.gitCommit,
    kubeContext: run.kubeContext,
    rulesChecked: run.rulesChecked,
    declaredRecordCount: run.declaredRecordCount,
    liveRecordCount: run.liveRecordCount,
    findingCount: run.findingCount,
    findingsBySeverity,
    warningCount: run.warnings.length,
    errorMessage: run.errorMessage,
  };
}

export function findingView(f: FindingWithNames): FindingView {
  return {
    id: f.id,
    rule: f.rule.name,
    environment: f.environment.name,
    representation: f.representation,
    kind: f.resourceKind,
    name: f.resourceName,
    property: f.property,
    expected: f.expected,
    observed: f.observed,
    severity: f.severity,
  };
}

export function runDetailView(run: ValidationRun, findings: FindingWithNames[]): RunDetailView {
  const counts = emptySeverityCounts();
  for (const f of findings) counts[f.severity] += 1;
  return {
    ...runSummaryView(run, counts),
    warnings: run.warnings,
    findings: findings.map(findingView),
  };
}

export function ruleView(rule: Rule) {
  return {
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    description: rule.description,
    resource: rule.resource,
    property: rule.property,
    environments: rule.environments,
    condition: rule.condition,
    severity: rule.severity,
    enabled: rule.enabled,
  };
}

export function environmentView(env: Environment) {
  return {
    id: env.id,
    name: env.name,
    gitDirectory: env.gitDirectory,
    k8sNamespace: env.k8sNamespace,
  };
}
