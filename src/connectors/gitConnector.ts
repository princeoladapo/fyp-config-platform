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

export function readDeclaredConfiguration(
  repository: string,
  ref: string,
  environments: EnvironmentMapping[],
): NormalizedRecord[] {
  const records: NormalizedRecord[] = [];

  for (const env of environments) {
    const directory = env.gitDirectory.replace(/\\/g, '/').replace(/\/$/, '');

    // List the YAML files committed inside this environment's directory.
    const files = git(repository, ['ls-tree', '-r', '--name-only', ref, '--', directory])
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => /\.ya?ml$/i.test(f));

    if (files.length === 0) {
      console.warn(`[git] No committed YAML files in ${directory} at ${ref}. Have they been committed?`);
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

  return records;
}
