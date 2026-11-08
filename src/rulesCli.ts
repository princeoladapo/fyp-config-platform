// Small command-line tool for the rules stored in the database.
// Usage:
//   npx tsx src/rulesCli.ts list
//   npx tsx src/rulesCli.ts enable <rule-name>
//   npx tsx src/rulesCli.ts disable <rule-name>

import { createPrismaClient } from './db';
import { PrismaClient } from '../generated/prisma/client';

const USAGE = 'Usage: npx tsx src/rulesCli.ts list | enable <rule-name> | disable <rule-name>';

async function list(prisma: PrismaClient) {
  const rules = await prisma.rule.findMany({ orderBy: { id: 'asc' } });
  if (rules.length === 0) {
    console.log('No rules in the database. Seed them with: npx prisma db seed');
    return;
  }
  const rows = rules.map((r) => [r.name, r.kind, r.severity, r.enabled ? 'yes' : 'no']);
  const header = ['NAME', 'KIND', 'SEVERITY', 'ENABLED'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd();
  console.log(line(header));
  rows.forEach((row) => console.log(line(row)));
}

async function setEnabled(prisma: PrismaClient, name: string | undefined, enabled: boolean) {
  if (!name) throw new Error(USAGE);
  const result = await prisma.rule.updateMany({ where: { name }, data: { enabled } });
  if (result.count === 0) {
    throw new Error(`No rule named "${name}". Run "npx tsx src/rulesCli.ts list" to see the rule names.`);
  }
  console.log(`Rule "${name}" ${enabled ? 'enabled' : 'disabled'}.`);
}

async function main() {
  const [command, name] = process.argv.slice(2);
  if (command !== 'list' && command !== 'enable' && command !== 'disable') {
    throw new Error(USAGE);
  }
  const prisma = createPrismaClient();
  try {
    if (command === 'list') await list(prisma);
    else await setEnabled(prisma, name, command === 'enable');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
