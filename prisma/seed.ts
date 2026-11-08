// Seeds the environments and rules tables from the files kept in the repository:
//   config/environments.yaml -> environments
//   rules/rules.yaml         -> rules
// Rows are matched on name (upsert), so running the seed again creates no duplicates.
// On an existing rule, `enabled` is left alone, so re-seeding does not undo a rule
// switched off with the rules CLI. Rules removed from rules.yaml are not deleted.
// Run with: npx prisma db seed

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { loadConfig } from '../src/config';
import { createPrismaClient } from '../src/db';
import { ruleKindOf } from '../src/rules/ruleKind';
import { Severity } from '../generated/prisma/client';

interface SeedRule {
  rule: string;
  description?: string;
  resource: string;
  property: string;
  environments?: string[];
  condition: string;
  severity: string;
}

const SEVERITIES: Record<string, Severity> = {
  high: Severity.HIGH,
  medium: Severity.MEDIUM,
  low: Severity.LOW,
};

async function main() {
  const prisma = createPrismaClient();
  try {
    const config = loadConfig('config/environments.yaml');
    for (const env of config.environments) {
      const data = { gitDirectory: env.gitDirectory, k8sNamespace: env.namespace };
      await prisma.environment.upsert({
        where: { name: env.name },
        create: { name: env.name, ...data },
        update: data,
      });
    }

    const rules: SeedRule[] = parse(readFileSync('rules/rules.yaml', 'utf8'))?.rules ?? [];
    for (const r of rules) {
      const kind = ruleKindOf(r.condition);
      if (!kind) throw new Error(`Rule "${r.rule}": unrecognised condition "${r.condition}"`);
      const severity = SEVERITIES[String(r.severity).toLowerCase()];
      if (!severity) throw new Error(`Rule "${r.rule}": unknown severity "${r.severity}"`);

      const data = {
        kind,
        description: r.description ?? null,
        resource: r.resource,
        property: r.property,
        environments: r.environments ?? [],
        condition: r.condition,
        severity,
      };
      await prisma.rule.upsert({
        where: { name: r.rule },
        create: { name: r.rule, ...data },
        update: data,
      });
    }

    const [envCount, ruleCount] = await Promise.all([prisma.environment.count(), prisma.rule.count()]);
    console.log(`Seeded ${config.environments.length} environments and ${rules.length} rules.`);
    console.log(`The database now holds ${envCount} environments and ${ruleCount} rules.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
