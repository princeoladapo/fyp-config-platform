// Typed client for the reporting API. Every call goes to a relative /api URL, which the
// Vite dev server proxies to the API on 127.0.0.1:3000 (see vite.config.ts).
// The shapes mirror src/api/views.ts in the main project.

export type RunStatus = 'RUNNING' | 'CONSISTENT' | 'VIOLATIONS_FOUND' | 'FAILED';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
export type Representation = 'DECLARED' | 'LIVE';
export type RuleKind = 'FIXED_CONDITION' | 'SAME_VALUE' | 'RELATIONSHIP';

export interface SeverityCounts {
  HIGH: number;
  MEDIUM: number;
  LOW: number;
}

export interface RunSummary {
  id: number;
  startedAt: string;
  completedAt: string | null;
  status: RunStatus;
  durationMs: number | null;
  gitRef: string;
  gitCommit: string | null;
  kubeContext: string | null;
  rulesChecked: number | null;
  declaredRecordCount: number | null;
  liveRecordCount: number | null;
  findingCount: number | null;
  findingsBySeverity: SeverityCounts;
  warningCount: number;
  errorMessage: string | null;
}

export interface Finding {
  id: number;
  rule: string;
  environment: string;
  representation: Representation;
  kind: string;
  name: string;
  property: string;
  expected: string;
  observed: string;
  severity: Severity;
}

export interface RunDetail extends RunSummary {
  warnings: string[];
  findings: Finding[];
}

export interface Rule {
  id: number;
  name: string;
  kind: RuleKind;
  description: string | null;
  resource: string;
  property: string;
  environments: string[];
  condition: string;
  severity: Severity;
  enabled: boolean;
}

export interface Environment {
  id: number;
  name: string;
  gitDirectory: string;
  k8sNamespace: string;
}

// The API process is not running (or the dev proxy cannot reach it).
export class ApiUnreachableError extends Error {
  constructor() {
    super('The reporting API is not running. Start it in another Command Prompt window with: npm run api');
    this.name = 'ApiUnreachableError';
  }
}

// The API answered with an error status; body is whatever it sent (e.g. a FAILED run).
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Only a request that carries a body is JSON. Declaring application/json on a bodiless
  // request (POST /api/runs) makes Fastify reject it: "Body cannot be empty when
  // content-type is set to 'application/json'".
  const headers: Record<string, string> = init?.body !== undefined ? { 'content-type': 'application/json' } : {};
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new ApiUnreachableError();
  }
  // Vite answers 502 or 504 itself when the proxied API is down.
  if (response.status === 502 || response.status === 504) throw new ApiUnreachableError();

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `The API answered with HTTP ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string; database: string }>('/api/health'),
  environments: () => request<Environment[]>('/api/environments'),
  rules: () => request<Rule[]>('/api/rules'),
  setRuleEnabled: (name: string, enabled: boolean) =>
    request<Rule>(`/api/rules/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  runs: () => request<RunSummary[]>('/api/runs'),
  run: (id: number) => request<RunDetail>(`/api/runs/${id}`),
  startRun: () => request<RunDetail>('/api/runs', { method: 'POST' }),
};

// A failed run comes back as HTTP 500 with { error, run }; pull the run out if present.
export function failedRunFromError(error: unknown): RunDetail | null {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'run' in error.body) {
    const run = (error.body as { run: unknown }).run;
    if (run && typeof run === 'object' && 'id' in run) return run as RunDetail;
  }
  return null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
