// Turns findings into the text the demo and the runs CLI print.
// Returns lines rather than printing, so callers decide where the text goes.

import { EngineFinding } from '../engine/types';

export function formatFindings(findings: EngineFinding[]): string[] {
  if (findings.length === 0) return ['CONSISTENT: no violations found.'];

  const lines = [`${findings.length} violation(s) found:`, ''];
  findings.forEach((f, i) => {
    lines.push(
      `${i + 1}. [${f.severity.toUpperCase()}] ${f.rule}`,
      `   Environment:    ${f.environment} (${f.representation})`,
      `   Resource:       ${f.kind}/${f.name}`,
      `   Property:       ${f.property}`,
      `   Expected:       ${f.expected}`,
      `   Observed:       ${f.observed}`,
      '',
    );
  });
  return lines;
}
