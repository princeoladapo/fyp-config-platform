// Loads the environment mapping (Section 3.6.2) from the environments table:
// which Git directory and which Kubernetes namespace belong to each environment.
// The table is filled from config/environments.yaml by the seed script.

import { PrismaClient } from '../../generated/prisma/client';
import { EnvironmentMapping } from '../config';

export interface StoredEnvironment extends EnvironmentMapping {
  id: number;
}

// Ordered by id, which is seed order (development, staging, production). The order
// matters: in a SAME_VALUE tie the engine prefers the first environment listed.
export async function loadEnvironments(prisma: PrismaClient): Promise<StoredEnvironment[]> {
  const rows = await prisma.environment.findMany({ orderBy: { id: 'asc' } });
  if (rows.length === 0) {
    throw new Error('No environments in the database. Seed them with: npx prisma db seed');
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    gitDirectory: r.gitDirectory,
    namespace: r.k8sNamespace,
  }));
}
