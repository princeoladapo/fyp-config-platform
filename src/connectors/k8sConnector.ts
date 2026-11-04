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

export async function readLiveConfiguration(
  environments: EnvironmentMapping[],
  context?: string,
): Promise<NormalizedRecord[]> {
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromDefault();
  if (context) kubeConfig.setCurrentContext(context);

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
        `[k8s] Could not read namespace "${namespace}" (context ${kubeConfig.getCurrentContext()}). ` +
          `Is Docker Desktop running and does the namespace exist? ${(error as Error).message}`,
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
