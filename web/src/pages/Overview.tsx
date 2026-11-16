// Overview: the latest run, its findings by severity, and the "Run validation" button.

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, failedRunFromError, RunDetail, RunSummary } from '../api';
import {
  EmptyState, ErrorState, formatDateTime, formatDuration, Loading, shortCommit, StatusBadge,
} from '../components';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running'; startedAt: number }
  | { phase: 'done'; run: RunDetail }
  | { phase: 'failed'; message: string; run: RunDetail | null };

export function Overview() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [state, setState] = useState<RunState>({ phase: 'idle' });

  const load = useCallback(() => {
    setLoadError(null);
    api.runs().then(setRuns).catch(setLoadError);
  }, []);
  useEffect(load, [load]);

  async function startRun() {
    setState({ phase: 'running', startedAt: Date.now() });
    try {
      const run = await api.startRun();
      setState({ phase: 'done', run });
    } catch (error) {
      setState({ phase: 'failed', message: errorMessage(error), run: failedRunFromError(error) });
    } finally {
      load();
    }
  }

  const latest = runs?.[0] ?? null;
  const running = state.phase === 'running';

  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <button type="button" className="primary" onClick={startRun} disabled={running || loadError !== null}>
          {running ? 'Running validation...' : 'Run validation'}
        </button>
      </div>

      {state.phase === 'running' && (
        <div className="panel progress" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Reading declared configuration from Git and live configuration from the cluster,
          then evaluating the rules. This usually takes about a second.
        </div>
      )}
      {state.phase === 'done' && <RunResult run={state.run} />}
      {state.phase === 'failed' && (
        <div className="panel result failed" role="alert">
          <p className="state-title">The run failed</p>
          <p className="error-text">{state.message}</p>
          {state.run && (
            <p>
              Stored as <a href={`#/runs/${state.run.id}`}>run #{state.run.id}</a> (FAILED).
            </p>
          )}
        </div>
      )}

      {loadError !== null ? (
        <ErrorState error={loadError} retry={load} />
      ) : runs === null ? (
        <Loading what="the latest run" />
      ) : latest === null ? (
        <EmptyState title="No validation runs yet">
          <p>Press "Run validation" to check the three environments against the rules.</p>
        </EmptyState>
      ) : (
        <LatestRun run={latest} />
      )}
    </>
  );
}

function RunResult({ run }: { run: RunDetail }) {
  return (
    <div className={`panel result ${run.status.toLowerCase()}`} aria-live="polite">
      <p className="state-title">
        Run #{run.id} finished: <StatusBadge status={run.status} />
      </p>
      <p>
        {run.findingCount === 0
          ? 'No violations. Every rule holds in the declared and the live configuration.'
          : `${run.findingCount} finding(s) in ${formatDuration(run.durationMs)}.`}{' '}
        <a href={`#/runs/${run.id}`}>See the run</a>
      </p>
      {run.warnings.length > 0 && (
        <ul className="warnings">
          {run.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LatestRun({ run }: { run: RunSummary }) {
  const counts = run.findingsBySeverity;
  return (
    <section>
      <h2>
        Latest run: <a href={`#/runs/${run.id}`}>#{run.id}</a> <StatusBadge status={run.status} />
      </h2>
      {run.status === 'FAILED' && (
        <div className="panel result failed">
          <p className="state-title">This run failed</p>
          <p className="error-text">{run.errorMessage ?? 'No error message was stored.'}</p>
        </div>
      )}
      <div className="tiles">
        <Tile label="High" value={counts.HIGH} className="severity-high" />
        <Tile label="Medium" value={counts.MEDIUM} className="severity-medium" />
        <Tile label="Low" value={counts.LOW} className="severity-low" />
        <Tile label="Warnings" value={run.warningCount} className="warning" />
      </div>
      <dl className="facts">
        <dt>Started</dt>
        <dd>{formatDateTime(run.startedAt)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(run.durationMs)}</dd>
        <dt>Git commit</dt>
        <dd>
          {run.gitRef} = <code>{shortCommit(run.gitCommit)}</code>
        </dd>
        <dt>Kubernetes context</dt>
        <dd>{run.kubeContext ?? 'current context'}</dd>
        <dt>Rules checked</dt>
        <dd>{run.rulesChecked ?? '-'}</dd>
        <dt>Records</dt>
        <dd>
          {run.declaredRecordCount ?? '-'} declared, {run.liveRecordCount ?? '-'} live
        </dd>
      </dl>
    </section>
  );
}

function Tile({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`tile ${className} ${value === 0 ? 'zero' : ''}`}>
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}
