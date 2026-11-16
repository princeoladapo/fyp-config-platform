// Small pieces shared by the pages: status and severity badges, the empty, loading and
// error states, and formatting helpers.

import { ReactNode } from 'react';
import { ApiUnreachableError, RunStatus, Severity, SeverityCounts } from './api';

export function StatusBadge({ status }: { status: RunStatus }) {
  const label: Record<RunStatus, string> = {
    RUNNING: 'Running',
    CONSISTENT: 'Consistent',
    VIOLATIONS_FOUND: 'Violations found',
    FAILED: 'Failed',
  };
  return <span className={`badge status-${status.toLowerCase()}`}>{label[status]}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge severity-${severity.toLowerCase()}`}>{severity}</span>;
}

// "2 HIGH, 1 MEDIUM" or a dash when there are none.
export function SeveritySummary({ counts }: { counts: SeverityCounts }) {
  const parts = (['HIGH', 'MEDIUM', 'LOW'] as const).filter((s) => counts[s] > 0);
  if (parts.length === 0) return <span className="muted">none</span>;
  return (
    <span className="severity-summary">
      {parts.map((s) => (
        <span key={s} className={`badge severity-${s.toLowerCase()}`}>
          {counts[s]} {s}
        </span>
      ))}
    </span>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="state muted">Loading {what}...</p>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state empty">
      <p className="state-title">{title}</p>
      {children}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const unreachable = error instanceof ApiUnreachableError;
  return (
    <div className="state error" role="alert">
      <p className="state-title">{unreachable ? 'Cannot reach the reporting API' : 'Something went wrong'}</p>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {unreachable && (
        <p className="muted">
          Then reload this page. The dashboard talks to the API through the Vite dev proxy
          (http://127.0.0.1:3000).
        </p>
      )}
      {retry && (
        <button type="button" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}

// Day/month/year and 24-hour time in the browser's local time zone, e.g. 16/11/2026, 14:51:06.
export function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}, ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function shortCommit(sha: string | null): string {
  return sha ? sha.slice(0, 12) : '-';
}
