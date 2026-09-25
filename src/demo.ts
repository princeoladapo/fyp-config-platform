// Runs the rules engine against the sample records and prints the findings.
// Usage: npm run demo

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { evaluate } from './engine/rulesEngine';
import { NormalizedRecord, RuleDefinition } from './engine/types';

const ENVIRONMENTS = ['development', 'staging', 'production'];

const records: NormalizedRecord[] = JSON.parse(
  readFileSync('fixtures/records.json', 'utf8'),
);
const rules: RuleDefinition[] = parse(
  readFileSync('rules/rules.yaml', 'utf8'),
).rules;

const findings = evaluate(records, rules, ENVIRONMENTS);

console.log(`Checked ${records.length} records against ${rules.length} rules.\n`);

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
