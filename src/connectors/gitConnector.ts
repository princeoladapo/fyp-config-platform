// Git connector (Chapter Three, Section 3.6.1).
// Reads the configuration declared for each environment from a Git repository.
// It reads files as they exist in a commit (default: HEAD), not unsaved
// changes in the folder, because "declared in Git" means committed.

import { execFileSync } from 'child_process';
import { parseAllDocuments } from 'yaml';
import { NormalizedRecord } from '../engine/types';
import { normalizeResource } from '../normalization/normalize';
import { EnvironmentMapping } from '../config';

function git(repository: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
}

// Turns a ref such as HEAD or main into the full commit SHA it points to now.
// A run reads the manifests at this SHA, so the commit it records is exactly the
// one it checked, even if a new commit is made while the run is going.
export function resolveCommit(repository: string, ref: string): string {
  try {
    return git(repository, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim();
  } catch {
    throw new Error(`Git ref "${ref}" does not name a commit in ${repository}`);
  }
}

export interface DeclaredConfiguration {
  records: NormalizedRecord[];
  // Problems that did not stop the read, e.g. an environment directory with nothing
  // committed. Returned rather than printed so the run can store them (increment 5b).
  warnings: string[];
}

export function readDeclaredConfiguration(
  repository: string,
  ref: string,
  environments: EnvironmentMapping[],
): DeclaredConfiguration {
  const records: NormalizedRecord[] = [];
  const warnings: string[] = [];

  for (const env of environments) {
    const directory = env.gitDirectory.replace(/\\/g, '/').replace(/\/$/, '');

    // List the YAML files committed inside this environment's directory.
    const files = git(repository, ['ls-tree', '-r', '--name-only', ref, '--', directory])
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => /\.ya?ml$/i.test(f));

    if (files.length === 0) {
      warnings.push(
        `No committed YAML in ${directory} at ${ref.slice(0, 12)} for environment ${env.name}. ` +
          'Have the manifests been committed?',
      );
      continue;
    }

    for (const file of files) {
      const text = git(repository, ['show', `${ref}:${file}`]);
      // One file can hold several resources separated by "---".
      for (const doc of parseAllDocuments(text)) {
        if (doc.errors.length > 0) {
          throw new Error(`YAML error in ${file}: ${doc.errors[0]?.message}`);
        }
        records.push(...normalizeResource(doc.toJS(), env.name, 'declared'));
      }
    }
  }

  return { records, warnings };
}
