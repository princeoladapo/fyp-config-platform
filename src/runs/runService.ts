// Executes one validation run and stores it (increment five, part a).
// A run is created as RUNNING, then: environments and enabled rules are loaded from the
// database, declared configuration is read from Git at a resolved commit, live
// configuration is read from Kubernetes, and the rules engine evaluates both. The
// findings and the finished run are written in one transaction. If any step fails the
// run is stored as FAILED with the error message, and the error is rethrown.
// Nothing here prints, so the reporting API (increment 5b) can call executeRun too.

import {
  Prisma,
  PrismaClient,
  Representation as DbRepresentation,
  RunStatus,
  Severity as DbSeverity,
  ValidationRun,
} from '../../generated/prisma/client';
import { loadPlatformSettings } from '../config';
import { readDeclaredConfiguration, resolveCommit } from '../connectors/gitConnector';
import { readLiveConfiguration } from '../connectors/k8sConnector';
import { evaluate } from '../engine/rulesEngine';
import { EngineFinding, Representation, Severity } from '../engine/types';
import { loadEnvironments } from '../environments/environmentRepository';
import { loadEnabledRules } from '../rules/ruleRepository';

export const SETTINGS_FILE = 'config/environments.yaml';

export interface RunOutcome {
  run: ValidationRun;
  findings: EngineFinding[];
}

// Thrown when a run fails after it was stored; runId names the FAILED run.
export class RunFailedError extends Error {
  constructor(public readonly runId: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'RunFailedError';
  }
}

const TO_DB_SEVERITY: Record<Severity, DbSeverity> = {
  high: DbSeverity.HIGH,
  medium: DbSeverity.MEDIUM,
  low: DbSeverity.LOW,
};
const TO_DB_REPRESENTATION: Record<Representation, DbRepresentation> = {
  declared: DbRepresentation.DECLARED,
  live: DbRepresentation.LIVE,
};

export async function executeRun(prisma: PrismaClient): Promise<RunOutcome> {
  const settings = loadPlatformSettings(SETTINGS_FILE);
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);

  const run = await prisma.validationRun.create({
    data: {
      status: RunStatus.RUNNING,
      gitRef: settings.ref,
      kubeContext: settings.kubeContext ?? null,
    },
  });

  // Filled in as each stage finishes; written to the run whether it completes or fails.
  const progress: Prisma.ValidationRunUpdateInput = {};

  try {
    const environments = await loadEnvironments(prisma);
    const rules = await loadEnabledRules(prisma);
    progress.rulesChecked = rules.length;

    const commit = resolveCommit(settings.repository, settings.ref);
    progress.gitCommit = commit;

    const declared = readDeclaredConfiguration(settings.repository, commit, environments);
    progress.declaredRecordCount = declared.length;

    const live = await readLiveConfiguration(environments, settings.kubeContext);
    progress.liveRecordCount = live.length;

    const findings = evaluate([...declared, ...live], rules, environments.map((e) => e.name));
    progress.findingCount = findings.length;

    // The engine names rules and environments; the findings table stores their ids.
    const ruleRows = await prisma.rule.findMany({
      where: { name: { in: rules.map((r) => r.rule) } },
      select: { id: true, name: true },
    });
    const ruleIds = new Map(ruleRows.map((r) => [r.name, r.id]));
    const environmentIds = new Map(environments.map((e) => [e.name, e.id]));

    const rows: Prisma.FindingCreateManyInput[] = findings.map((f) => {
      const ruleId = ruleIds.get(f.rule);
      const environmentId = environmentIds.get(f.environment);
      if (ruleId === undefined) throw new Error(`Finding refers to unknown rule "${f.rule}"`);
      if (environmentId === undefined) throw new Error(`Finding refers to unknown environment "${f.environment}"`);
      return {
        runId: run.id,
        ruleId,
        environmentId,
        resourceKind: f.kind,
        resourceName: f.name,
        property: f.property,
        expected: f.expected,
        observed: f.observed,
        severity: TO_DB_SEVERITY[f.severity],
        representation: TO_DB_REPRESENTATION[f.representation],
      };
    });

    const [, finished] = await prisma.$transaction([
      prisma.finding.createMany({ data: rows }),
      prisma.validationRun.update({
        where: { id: run.id },
        data: {
          ...progress,
          status: findings.length === 0 ? RunStatus.CONSISTENT : RunStatus.VIOLATIONS_FOUND,
          completedAt: new Date(),
          durationMs: elapsed(),
        },
      }),
    ]);

    return { run: finished, findings };
  } catch (error) {
    try {
      await prisma.validationRun.update({
        where: { id: run.id },
        data: {
          ...progress,
          status: RunStatus.FAILED,
          completedAt: new Date(),
          durationMs: elapsed(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      // Recording the failure failed too (e.g. the database went away);
      // the original error is the one worth reporting.
    }
    throw new RunFailedError(run.id, error);
  }
}

// The findings stored for one run, in the shape the engine returns them.
export async function loadRunFindings(prisma: PrismaClient, runId: number): Promise<EngineFinding[]> {
  const rows = await prisma.finding.findMany({
    where: { runId },
    orderBy: { id: 'asc' },
    include: { rule: { select: { name: true } }, environment: { select: { name: true } } },
  });
  return rows.map((f) => ({
    rule: f.rule.name,
    environment: f.environment.name,
    representation: f.representation.toLowerCase() as Representation,
    kind: f.resourceKind,
    name: f.resourceName,
    property: f.property,
    expected: f.expected,
    observed: f.observed,
    severity: f.severity.toLowerCase() as Severity,
  }));
}
