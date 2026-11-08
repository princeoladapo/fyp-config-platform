// Runs a full validation: declared configuration from Git and
// live configuration from the Kubernetes cluster.
// Rules are loaded from the database (seed it first with: npx prisma db seed).
// Usage: npx tsx src/demo.ts

import { loadConfig } from './config';
import { readDeclaredConfiguration } from './connectors/gitConnector';
import { readLiveConfiguration } from './connectors/k8sConnector';
import { evaluate } from './engine/rulesEngine';
import { createPrismaClient } from './db';
import { loadEnabledRules } from './rules/ruleRepository';

async function main() {
  const config = loadConfig('config/environments.yaml');
  const environmentNames = config.environments.map((e) => e.name);

  const prisma = createPrismaClient();
  let rules;
  try {
    rules = await loadEnabledRules(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`Loaded ${rules.length} rules from the database.`);

  const declared = readDeclaredConfiguration(config.repository, config.ref, config.environments);
  const live = await readLiveConfiguration(config.environments, config.kubeContext);

  const findings = evaluate([...declared, ...live], rules, environmentNames);

  console.log(`Read ${declared.length} declared records from Git (${config.ref}).`);
  console.log(`Read ${live.length} live records from Kubernetes (${config.kubeContext ?? 'current context'}).`);
  console.log(`Checked against ${rules.length} rules.\n`);

  if (findings.length === 0) {
    console.log('CONSISTENT: no violations found.');
  } else {
    console.log(`${findings.length} violation(s) found:\n`);
    findings.forEach((f, i) => {
      console.log(`${i + 1}. [${f.severity.toUpperCase()}] ${f.rule}`);
      console.log(`   Environment:    ${f.environment} (${f.representation})`);
      console.log(`   Resource:       ${f.kind}/${f.name}`);
      console.log(`   Property:       ${f.property}`);
      console.log(`   Expected:       ${f.expected}`);
      console.log(`   Observed:       ${f.observed}\n`);
    });
  }
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exit(1);
});
