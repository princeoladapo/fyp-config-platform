// Reads config/environments.yaml.
// - Platform settings (repository, ref, kubeContext) are read from here on every run.
// - The environments list (Section 3.6.2: which Git directory and namespace belong to each
//   environment) is only the seed source: prisma/seed.ts copies it into the environments
//   table, and runs take the mapping from the database.

import { readFileSync } from 'fs';
import { parse } from 'yaml';

export interface EnvironmentMapping {
  name: string;
  gitDirectory: string;
  namespace: string;
}

export interface PlatformSettings {
  repository: string;   // path to the Git repository
  ref: string;          // which commit or branch to read, e.g. HEAD or main
  kubeContext?: string; // kubeconfig context to read live config from; default: current context
}

export interface PlatformConfig extends PlatformSettings {
  environments: EnvironmentMapping[];
}

// The settings a validation run needs; the environments list is not required.
export function loadPlatformSettings(path: string): PlatformSettings {
  const config = parse(readFileSync(path, 'utf8')) as Partial<PlatformSettings> | null;
  return {
    repository: config?.repository ?? '.',
    ref: config?.ref ?? 'HEAD',
    kubeContext: config?.kubeContext,
  };
}

// Settings plus the environments list; used by the seed script.
export function loadConfig(path: string): PlatformConfig {
  const config = parse(readFileSync(path, 'utf8')) as PlatformConfig;
  if (!config?.environments?.length) {
    throw new Error(`No environments defined in ${path}`);
  }
  return {
    repository: config.repository ?? '.',
    ref: config.ref ?? 'HEAD',
    kubeContext: config.kubeContext,
    environments: config.environments,
  };
}
