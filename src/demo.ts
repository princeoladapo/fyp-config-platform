// Runs a full validation: declared configuration from Git (real),
// live configuration from fixtures (until the Kubernetes connector exists).
// Usage: npx tsx src/demo.ts

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { loadConfig } from './config';
import { readDeclaredConfiguration } from './connectors/gitConnector';
import { evaluate } from './engine/rulesEngine';
import { NormalizedRecord, RuleDefinition } from './engine/types';

const config = loadConfig('config/environments.yaml');
const environmentNames = config.environments.map((e) => e.name);

const declared = readDeclaredConfiguration(config.repository, config.ref, config.environments);
const live: NormalizedRecord[] = JSON.parse(readFileSync('fixtures/live-records.json', 'utf8'));
const rules: RuleDefinition[] = parse(readFileSync('rules/rules.yaml', 'utf8')).rules;

const findings = evaluate([...declared, ...live], rules, environmentNames);

console.log(`Read ${declared.length} declared records from Git (${config.ref}).`);
console.log(`Read ${live.length} live records from fixtures.`);
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
