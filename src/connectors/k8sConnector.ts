// Kubernetes connector (Chapter Three, Section 3.6.1).
// Reads the configuration that is actually running in each environment's
// namespace. It only uses get and list requests, so it never changes the cluster.
//
// Credentials come from the kubeconfig file (or the file named by the
// KUBECONFIG environment variable), never from the project or the database.
//
// Fields the API server fills in with defaults (strategy, imagePullPolicy,
// terminationMessagePath and so on) are kept. Rules only check the properties
// they name, so these extra records cannot cause a finding on their own.

import { AppsV1Api, CoreV1Api, KubeConfig } from '@kubernetes/client-node';
import { NormalizedRecord } from '../engine/types';
import { normalizeResource } from '../normalization/normalize';
import { EnvironmentMapping } from '../config';

// Created by Kubernetes in every namespace; not part of the application's configuration.
const IGNORED_CONFIGMAPS = ['kube-root-ca.crt'];

// A short, readable reason for a failed request. The client library's ApiException
// message is a multi-line dump (HTTP code, body, headers); the API server's own
// message plus the status code says enough. A connection failure (Docker Desktop
// closed, wrong server address) arrives as "fetch failed" with the real reason in cause.
// The API server answers with a Status object (as JSON text or already parsed);
// its "message" field is the part worth showing.
function serverMessage(body: unknown): string | undefined {
  let status = body;
  if (typeof body === 'string') {
    try { status = JSON.parse(body); } catch { return body.trim(); }
  }
  if (status && typeof status === 'object' && 'message' in status) {
    return String((status as { message: unknown }).message);
  }
  return undefined;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, body, cause, message } = error as {
      code?: number; body?: unknown; cause?: unknown; message?: string;
    };
    if (typeof code === 'number') {
      return `HTTP ${code} ${serverMessage(body) ?? message ?? ''}`.trim();
    }
    if (cause instanceof Error) return `${message}: ${cause.message}`;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

export async function readLiveConfiguration(
  environments: EnvironmentMapping[],
  context?: string,
): Promise<NormalizedRecord[]> {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  if (context) kubeConfig.setCurrentContext(context);
  const contextName = kubeConfig.getCurrentContext();

  const apps = kubeConfig.makeApiClient(AppsV1Api);
  const core = kubeConfig.makeApiClient(CoreV1Api);
  const records: NormalizedRecord[] = [];

  for (const env of environments) {
    const namespace = env.namespace;
    let deployments, services, configMaps;
    try {
      [deployments, services, configMaps] = await Promise.all([
        apps.listNamespacedDeployment({ namespace }),
        core.listNamespacedService({ namespace }),
        core.listNamespacedConfigMap({ namespace }),
      ]);
    } catch (error) {
      throw new Error(
        `Could not read live configuration from context ${contextName}, namespace ${namespace}: ` +
          describeError(error),
        { cause: error },
      );
    }

    // Items in a list response carry no "kind" field, so it is added back here.
    const resources = [
      ...deployments.items.map((r) => ({ ...r, kind: 'Deployment' })),
      ...services.items.map((r) => ({ ...r, kind: 'Service' })),
      ...configMaps.items
        .filter((r) => !IGNORED_CONFIGMAPS.includes(r.metadata?.name ?? ''))
        .map((r) => ({ ...r, kind: 'ConfigMap' })),
    ];

    for (const resource of resources) {
      records.push(...normalizeResource(resource, env.name, 'live'));
    }
  }

  return records;
}
