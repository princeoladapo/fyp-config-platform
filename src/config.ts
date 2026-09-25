// Loads the environment mapping (Chapter Three, Section 3.6.2):
// which Git directory and which Kubernetes namespace belong to each environment.

import { readFileSync } from 'fs';
import { parse } from 'yaml';

export interface EnvironmentMapping {
  name: string;
  gitDirectory: string;
  namespace: string;
}

export interface PlatformConfig {
  repository: string;   // path to the Git repository
  ref: string;          // which commit or branch to read, e.g. HEAD or main
  environments: EnvironmentMapping[];
}

export function loadConfig(path: string): PlatformConfig {
  const config = parse(readFileSync(path, 'utf8')) as PlatformConfig;
  if (!config?.environments?.length) {
    throw new Error(`No environments defined in ${path}`);
  }
  return { repository: config.repository ?? '.', ref: config.ref ?? 'HEAD', environments: config.environments };
}
