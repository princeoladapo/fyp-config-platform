// Command-line tool for the validation runs stored in the database.
// Usage:
//   npx tsx src/runsCli.ts list         every run: id, started, status, duration, findings
//   npx tsx src/runsCli.ts show <id>    one run's details and findings

import { createPrismaClient } from './db';
import { PrismaClient } from '../generated/prisma/client';
import { formatFindings } from './runs/formatFindings';
import { loadRunFindings } from './runs/runService';

const USAGE = 'Usage: npx tsx src/runsCli.ts list | show <run-id>';

// Local time as YYYY-MM-DD HH:MM:SS.
function timestamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

const duration = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(1)} s`);
const count = (n: number | null) => (n === null ? '-' : String(n));

async function list(prisma: PrismaClient) {
  const runs = await prisma.validationRun.findMany({ orderBy: { id: 'asc' } });
  if (runs.length === 0) {
    console.log('No runs stored yet. Run one with: npx tsx src/demo.ts');
    return;
  }
  const header = ['ID', 'STARTED', 'STATUS', 'DURATION', 'FINDINGS'];
  const rows = runs.map((r) => [
    String(r.id), timestamp(r.startedAt), r.status, duration(r.durationMs), count(r.findingCount),
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(line(header));
  rows.forEach((row) => console.log(line(row)));
}

async function show(prisma: PrismaClient, idText: string | undefined) {
  const id = Number(idText);
  if (!idText || !Number.isInteger(id) || id <= 0) throw new Error(USAGE);
  const run = await prisma.validationRun.findUnique({ where: { id } });
  if (!run) throw new Error(`No run with id ${id}. Run "npx tsx src/runsCli.ts list" to see the ids.`);

  console.log(`Run #${run.id}: ${run.status}`);
  console.log(`  Started:          ${timestamp(run.startedAt)}`);
  console.log(`  Completed:        ${run.completedAt ? timestamp(run.completedAt) : '-'}`);
  console.log(`  Duration:         ${duration(run.durationMs)}`);
  console.log(`  Git:              ${run.gitRef} = ${run.gitCommit ?? '-'}`);
  console.log(`  Kubernetes:       ${run.kubeContext ?? 'current context'}`);
  console.log(`  Rules checked:    ${count(run.rulesChecked)}`);
  console.log(`  Declared records: ${count(run.declaredRecordCount)}`);
  console.log(`  Live records:     ${count(run.liveRecordCount)}`);
  if (run.errorMessage) console.log(`  Error:            ${run.errorMessage.replace(/\n/g, '\n                    ')}`);
  console.log('');

  if (run.status === 'RUNNING' || run.status === 'FAILED') {
    console.log(run.status === 'RUNNING' ? 'The run has not finished.' : 'The run failed, so no findings were stored.');
    return;
  }
  formatFindings(await loadRunFindings(prisma, run.id)).forEach((l) => console.log(l));
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  if (command !== 'list' && command !== 'show') throw new Error(USAGE);
  const prisma = createPrismaClient();
  try {
    if (command === 'list') await list(prisma);
    else await show(prisma, arg);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
