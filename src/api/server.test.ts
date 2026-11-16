// Tests for the reporting API (increment 5b).
// Usage: npm run test:api
// Uses fastify.inject, so no port is opened. It needs the database, Git and the cluster,
// because the POST /api/runs test performs a real validation run. Everything the tests
// change is put back: the rule they toggle is restored and the fake RUNNING run used for
// the 409 case is deleted. The run that POST stores is left, like any other run.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FastifyInstance } from 'fastify';
import { PrismaClient, RunStatus } from '../../generated/prisma/client';
import { createPrismaClient } from '../db';
import { buildServer } from './server';
import { STALE_RUN_AFTER_MS, STALE_RUN_MESSAGE } from '../runs/runService';

const RULE = 'production-minimum-replicas';

let prisma: PrismaClient;
let app: FastifyInstance;

before(async () => {
  prisma = createPrismaClient();
  app = buildServer(prisma);
  await app.ready();
});

after(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('GET /api/health', () => {
  it('reports the database as reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { status: 'ok', database: 'ok' });
  });
});

describe('GET /api/environments', () => {
  it('lists the three environments in seed order with their mapping', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/environments' });
    assert.equal(res.statusCode, 200);
    const names = res.json().map((e: { name: string }) => e.name);
    assert.deepEqual(names, ['development', 'staging', 'production']);
    const production = res.json()[2];
    assert.equal(production.gitDirectory, 'sample-config/environments/production');
    assert.equal(production.k8sNamespace, 'production');
  });
});

describe('GET /api/rules', () => {
  it('lists the stored rules with kind, severity and enabled flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/rules' });
    assert.equal(res.statusCode, 200);
    const rules = res.json();
    assert.ok(rules.length >= 5, `expected at least 5 rules, got ${rules.length}`);
    const rule = rules.find((r: { name: string }) => r.name === RULE);
    assert.ok(rule, `rule ${RULE} is missing`);
    assert.equal(rule.kind, 'FIXED_CONDITION');
    assert.equal(rule.severity, 'HIGH');
    assert.equal(typeof rule.enabled, 'boolean');
    assert.equal(typeof rule.description, 'string');
  });
});

describe('PATCH /api/rules/:name', () => {
  it('switches a rule off and on again', async () => {
    const before = await prisma.rule.findUniqueOrThrow({ where: { name: RULE } });
    try {
      const off = await app.inject({ method: 'PATCH', url: `/api/rules/${RULE}`, payload: { enabled: false } });
      assert.equal(off.statusCode, 200);
      assert.equal(off.json().enabled, false);
      assert.equal((await prisma.rule.findUniqueOrThrow({ where: { name: RULE } })).enabled, false);

      const on = await app.inject({ method: 'PATCH', url: `/api/rules/${RULE}`, payload: { enabled: true } });
      assert.equal(on.statusCode, 200);
      assert.equal(on.json().enabled, true);
    } finally {
      await prisma.rule.update({ where: { name: RULE }, data: { enabled: before.enabled } });
    }
  });

  it('returns 404 for an unknown rule', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/rules/no-such-rule', payload: { enabled: false } });
    assert.equal(res.statusCode, 404);
    assert.match(res.json().error, /No rule named "no-such-rule"/);
  });

  it('returns 400 when enabled is not a boolean', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/api/rules/${RULE}`, payload: { enabled: 'yes' } });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /Invalid request/);
  });

  it('returns 400 when the body is empty or has unknown fields', async () => {
    const empty = await app.inject({ method: 'PATCH', url: `/api/rules/${RULE}`, payload: {} });
    assert.equal(empty.statusCode, 400);
    const extra = await app.inject({
      method: 'PATCH', url: `/api/rules/${RULE}`, payload: { enabled: true, severity: 'LOW' },
    });
    assert.equal(extra.statusCode, 400);
  });
});

describe('GET /api/runs', () => {
  it('lists runs newest first with severity counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs' });
    assert.equal(res.statusCode, 200);
    const runs = res.json();
    assert.ok(runs.length >= 1, 'expected at least one stored run');
    for (let i = 1; i < runs.length; i++) {
      assert.ok(runs[i - 1].id > runs[i].id, 'runs are not newest first');
    }
    const latest = runs[0];
    assert.ok(['CONSISTENT', 'VIOLATIONS_FOUND', 'FAILED', 'RUNNING'].includes(latest.status));
    assert.deepEqual(Object.keys(latest.findingsBySeverity).sort(), ['HIGH', 'LOW', 'MEDIUM']);
    assert.equal(typeof latest.warningCount, 'number');
    assert.ok('durationMs' in latest && 'errorMessage' in latest);
  });
});

describe('GET /api/runs/:id', () => {
  it('returns one run with warnings and findings', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/runs' })).json();
    const res = await app.inject({ method: 'GET', url: `/api/runs/${list[0].id}` });
    assert.equal(res.statusCode, 200);
    const run = res.json();
    assert.equal(run.id, list[0].id);
    assert.ok(Array.isArray(run.warnings));
    assert.ok(Array.isArray(run.findings));
    assert.equal(run.findings.length, run.findingCount ?? 0);
    for (const f of run.findings) {
      for (const key of ['rule', 'environment', 'representation', 'kind', 'name', 'property', 'expected', 'observed', 'severity']) {
        assert.ok(key in f, `finding is missing ${key}`);
      }
    }
  });

  it('returns 404 for a run that does not exist', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/runs/999999' });
    assert.equal(res.statusCode, 404);
    assert.match(res.json().error, /No run with id 999999/);
  });

  it('returns 400 for an id that is not a positive integer', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/runs/abc' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/runs/0' })).statusCode, 400);
  });
});

describe('POST /api/runs', () => {
  it('returns 409 while another run is RUNNING', async () => {
    const fake = await prisma.validationRun.create({ data: { status: RunStatus.RUNNING, gitRef: 'HEAD' } });
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs' });
      assert.equal(res.statusCode, 409);
      assert.match(res.json().error, new RegExp(`Run #${fake.id} is still running`));
    } finally {
      await prisma.validationRun.delete({ where: { id: fake.id } });
    }
  });

  it('marks a stale RUNNING row as FAILED instead of letting it block a run', async () => {
    const startedAt = new Date(Date.now() - STALE_RUN_AFTER_MS - 60_000);
    const stale = await prisma.validationRun.create({ data: { status: RunStatus.RUNNING, gitRef: 'HEAD', startedAt } });
    let newRunId: number | undefined;
    try {
      const res = await app.inject({ method: 'POST', url: '/api/runs' });
      assert.equal(res.statusCode, 201, `expected the stale row not to block the run: ${res.body}`);
      newRunId = res.json().id;

      const marked = await prisma.validationRun.findUniqueOrThrow({ where: { id: stale.id } });
      assert.equal(marked.status, RunStatus.FAILED);
      assert.equal(marked.errorMessage, STALE_RUN_MESSAGE);
      assert.ok(marked.completedAt, 'completedAt should be set on the stale run');

      const shown = await app.inject({ method: 'GET', url: `/api/runs/${stale.id}` });
      assert.equal(shown.json().status, 'FAILED');
    } finally {
      await prisma.validationRun.delete({ where: { id: stale.id } });
    }
    console.log(`    stale run #${stale.id} marked FAILED; new run #${newRunId} went ahead`);
  });

  it('performs a run and returns the stored result with its findings', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runs' });
    assert.equal(res.statusCode, 201, `run failed: ${res.body}`);
    const run = res.json();
    assert.ok(run.id > 0);
    assert.ok(['CONSISTENT', 'VIOLATIONS_FOUND'].includes(run.status), `unexpected status ${run.status}`);
    assert.ok(run.completedAt, 'completedAt should be set');
    assert.equal(run.findings.length, run.findingCount);
    assert.ok(run.rulesChecked >= 1);
    assert.ok(run.declaredRecordCount > 0 && run.liveRecordCount > 0);
    console.log(`    stored run #${run.id}: ${run.status}, ${run.findingCount} finding(s), ${run.durationMs} ms`);

    const stored = await app.inject({ method: 'GET', url: `/api/runs/${run.id}` });
    assert.equal(stored.statusCode, 200);
    assert.equal(stored.json().status, run.status);
  });
});

describe('unknown routes', () => {
  it('return 404 in the same error shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nothing' });
    assert.equal(res.statusCode, 404);
    assert.match(res.json().error, /No route GET \/api\/nothing/);
  });
});
