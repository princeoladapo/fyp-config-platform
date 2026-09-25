// Normalization layer (Chapter Three, Section 3.6.5).
// Turns one Kubernetes resource into a list of normalized records:
// (environment, representation, kind, name, property, value)
// Used by both the Git connector and, later, the Kubernetes connector.

import { NormalizedRecord, Representation } from '../engine/types';

// The resource types in the project scope (Chapter One, Section 1.6).
export const SUPPORTED_KINDS = ['Deployment', 'Service', 'ConfigMap'];

// Only these parts of a resource carry user configuration.
// Everything else (status, managedFields, resourceVersion, uid,
// timestamps, annotations added by the server) is left out on purpose.
const CONFIGURATION_SECTIONS = ['spec', 'data', 'metadata.labels'];

function getSection(resource: any, path: string): unknown {
  return path.split('.').reduce((obj, key) => (obj == null ? undefined : obj[key]), resource);
}

export function normalizeResource(
  resource: any,
  environment: string,
  representation: Representation,
): NormalizedRecord[] {
  if (!resource || !SUPPORTED_KINDS.includes(resource.kind)) return [];
  const name: string | undefined = resource.metadata?.name;
  if (!name) return [];

  const records: NormalizedRecord[] = [];

  // Walks nested objects and arrays, building paths such as
  // "spec.template.spec.containers[0].image".
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
    } else if (value !== null && value !== undefined) {
      records.push({
        environment,
        representation,
        kind: resource.kind,
        name,
        property: path,
        value: value as string | number | boolean,
      });
    }
  };

  for (const section of CONFIGURATION_SECTIONS) {
    const value = getSection(resource, section);
    if (value !== undefined) walk(value, section);
  }

  return records;
}
