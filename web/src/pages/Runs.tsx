// Runs: every stored run, newest first.

import { useCallback, useEffect, useState } from 'react';
import { api, RunSummary } from '../api';
import {
  EmptyState, ErrorState, formatDateTime, formatDuration, Loading, SeveritySummary, shortCommit, StatusBadge,
} from '../components';

export function Runs() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    api.runs().then(setRuns).catch(setError);
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <div className="page-header">
        <h1>Runs</h1>
        <button type="button" onClick={load}>Refresh</button>
      </div>
      {error !== null ? (
        <ErrorState error={error} retry={load} />
      ) : runs === null ? (
        <Loading what="runs" />
      ) : runs.length === 0 ? (
        <EmptyState title="No validation runs yet">
          <p>
            Start one from the <a href="#/">overview</a>.
          </p>
        </EmptyState>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Findings</th>
              <th>Warnings</th>
              <th>Commit</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <a href={`#/runs/${run.id}`}>#{run.id}</a>
                </td>
                <td>{formatDateTime(run.startedAt)}</td>
                <td>
                  <StatusBadge status={run.status} />
                </td>
                <td>{formatDuration(run.durationMs)}</td>
                <td>
                  {run.status === 'FAILED' || run.status === 'RUNNING' ? (
                    <span className="muted">-</span>
                  ) : (
                    <SeveritySummary counts={run.findingsBySeverity} />
                  )}
                </td>
                <td>{run.warningCount === 0 ? <span className="muted">-</span> : run.warningCount}</td>
                <td>
                  <code>{shortCommit(run.gitCommit)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
