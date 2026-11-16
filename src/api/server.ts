// Reporting interface (increment 5b): an HTTP API over the stored validation runs.
// Usage: npm run api   (then open http://127.0.0.1:3000/api/health)
//
// Endpoints:
//   GET   /api/health              database reachable or not
//   GET   /api/environments        the environment mapping (Section 3.6.2)
//   GET   /api/rules               every stored rule
//   PATCH /api/rules/:name         body {enabled: boolean}: switch a rule off or on
//   GET   /api/runs                stored runs, newest first, with findings counted by severity
//   GET   /api/runs/:id            one run with its warnings and findings
//   POST  /api/runs                start a validation run and return the stored result
//
// The API only reads Git and the cluster (through executeRun, which uses the read-only
// kubeconfig context); the only things it writes are rows in this platform's own
// database: runs, findings and a rule's enabled flag.
//
// Security (Section 3.6.8): the prototype has a single local user and no login, so the
// server listens on 127.0.0.1 only. Nothing else on the network can reach it. Adding
// users, authentication and roles is listed as future work.

import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import { PrismaClient, RunStatus, Severity } from '../../generated/prisma/client';
import { createPrismaClient } from '../db';
import { executeRun, markStaleRuns, RunFailedError } from '../runs/runService';
import {
  emptySeverityCounts, environmentView, ruleView, runDetailView, runSummaryView, SeverityCounts,
} from './views';

export const API_HOST = '127.0.0.1';
export const DEFAULT_PORT = 3000;

const ruleNameParams = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 200 } },
} as const;

const runIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
} as const;

const enabledBody = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: { enabled: { type: 'boolean' } },
} as const;

// The run with its findings, each carrying its rule and environment names.
async function loadRunDetail(prisma: PrismaClient, id: number) {
  const run = await prisma.validationRun.findUnique({ where: { id } });
  if (!run) return null;
  const findings = await prisma.finding.findMany({
    where: { runId: id },
    orderBy: { id: 'asc' },
    include: { rule: { select: { name: true } }, environment: { select: { name: true } } },
  });
  return runDetailView(run, findings);
}

export interface ServerOptions {
  logger?: boolean;
}

export function buildServer(prisma: PrismaClient, options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    // Fastify's default validator silently strips unknown body fields; reject them instead.
    ajv: { customOptions: { removeAdditional: false } },
  });

  // One error shape for everything: { error: "..." }. Schema validation failures
  // become 400; anything unexpected is logged and reported as 500.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.validation) {
      return reply.code(400).send({ error: `Invalid request: ${error.message}` });
    }
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode >= 500) app.log.error(error);
    return reply.code(statusCode).send({ error: error.message });
  });
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: `No route ${request.method} ${request.url}` });
  });

  app.get('/api/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      return reply.code(503).send({
        status: 'error',
        database: 'unreachable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get('/api/environments', async () => {
    const rows = await prisma.environment.findMany({ orderBy: { id: 'asc' } });
    return rows.map(environmentView);
  });

  app.get('/api/rules', async () => {
    const rows = await prisma.rule.findMany({ orderBy: { id: 'asc' } });
    return rows.map(ruleView);
  });

  app.patch<{ Params: { name: string }; Body: { enabled: boolean } }>(
    '/api/rules/:name',
    { schema: { params: ruleNameParams, body: enabledBody } },
    async (request, reply) => {
      const { name } = request.params;
      const existing = await prisma.rule.findUnique({ where: { name } });
      if (!existing) return reply.code(404).send({ error: `No rule named "${name}"` });
      const updated = await prisma.rule.update({ where: { name }, data: { enabled: request.body.enabled } });
      return ruleView(updated);
    },
  );

  app.get('/api/runs', async () => {
    const runs = await prisma.validationRun.findMany({ orderBy: { id: 'desc' } });
    const grouped = await prisma.finding.groupBy({ by: ['runId', 'severity'], _count: { _all: true } });
    const countsByRun = new Map<number, SeverityCounts>();
    for (const g of grouped) {
      const counts = countsByRun.get(g.runId) ?? emptySeverityCounts();
      counts[g.severity as Severity] = g._count._all;
      countsByRun.set(g.runId, counts);
    }
    return runs.map((run) => runSummaryView(run, countsByRun.get(run.id) ?? emptySeverityCounts()));
  });

  app.get<{ Params: { id: number } }>(
    '/api/runs/:id',
    { schema: { params: runIdParams } },
    async (request, reply) => {
      const detail = await loadRunDetail(prisma, request.params.id);
      if (!detail) return reply.code(404).send({ error: `No run with id ${request.params.id}` });
      return detail;
    },
  );

  // Only one run at a time. The flag covers two requests arriving together in this
  // process; the database check also covers a run started elsewhere (e.g. the demo).
  // A RUNNING row left by a crashed process is marked stale first so it cannot block forever.
  let runInProgress = false;
  app.post('/api/runs', async (_request, reply) => {
    if (runInProgress) return reply.code(409).send({ error: 'A validation run is already in progress' });
    await markStaleRuns(prisma);
    const running = await prisma.validationRun.findFirst({ where: { status: RunStatus.RUNNING } });
    if (running) {
      return reply.code(409).send({ error: `Run #${running.id} is still running` });
    }

    runInProgress = true;
    try {
      const { run } = await executeRun(prisma);
      return reply.code(201).send(await loadRunDetail(prisma, run.id));
    } catch (error) {
      if (error instanceof RunFailedError) {
        // The run is stored as FAILED with its message; return it so the caller can show it.
        return reply.code(500).send({ error: error.message, run: await loadRunDetail(prisma, error.runId) });
      }
      throw error;
    } finally {
      runInProgress = false;
    }
  });

  return app;
}

async function main() {
  const port = Number(process.env['API_PORT'] ?? DEFAULT_PORT);
  const prisma = createPrismaClient();
  const app = buildServer(prisma, { logger: true });
  app.addHook('onClose', async () => { await prisma.$disconnect(); });

  // Loopback only: see the security note at the top of this file.
  await app.listen({ host: API_HOST, port });
  console.log(`Reporting API listening on http://${API_HOST}:${port}/api/health (press Ctrl+C to stop)`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { app.close().then(() => process.exit(0)); });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
