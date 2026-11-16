// Run detail: the run's facts, its warnings, and a findings table that can be filtered by
// environment, severity and representation.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, Representation, RunDetail, Severity } from '../api';
import {
  EmptyState, ErrorState, formatDateTime, formatDuration, Loading, SeverityBadge, StatusBadge,
} from '../components';

const ALL = 'all';

export function RunDetailPage({ id }: { id: number }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [environment, setEnvironment] = useState(ALL);
  const [severity, setSeverity] = useState(ALL);
  const [representation, setRepresentation] = useState(ALL);

  const load = useCallback(() => {
    setError(null);
    setRun(null);
    api.run(id).then(setRun).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  const environments = useMemo(
    () => Array.from(new Set(run?.findings.map((f) => f.environment) ?? [])),
    [run],
  );
  const visible = useMemo(
    () =>
      (run?.findings ?? []).filter(
        (f) =>
          (environment === ALL || f.environment === environment) &&
          (severity === ALL || f.severity === (severity as Severity)) &&
          (representation === ALL || f.representation === (representation as Representation)),
      ),
    [run, environment, severity, representation],
  );

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState title={`There is no run #${id}`}>
        <a href="#/runs">Back to the runs</a>
      </EmptyState>
    );
  }
  if (error !== null) return <ErrorState error={error} retry={load} />;
  if (run === null) return <Loading what={`run #${id}`} />;

  const filtered = visible.length !== run.findings.length;

  return (
    <>
      <p className="breadcrumb">
        <a href="#/runs">Runs</a> / Run #{run.id}
      </p>
      <div className="page-header">
        <h1>
          Run #{run.id} <StatusBadge status={run.status} />
        </h1>
      </div>

      <dl className="facts">
        <dt>Started</dt>
        <dd>{formatDateTime(run.startedAt)}</dd>
        <dt>Completed</dt>
        <dd>{formatDateTime(run.completedAt)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(run.durationMs)}</dd>
        <dt>Git commit</dt>
        <dd>
          {run.gitRef} = <code>{run.gitCommit ?? '-'}</code>
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

      {run.status === 'FAILED' && (
        <div className="panel result failed" role="alert">
          <p className="state-title">This run failed, so no findings were stored</p>
          <p className="error-text">{run.errorMessage ?? 'No error message was stored.'}</p>
        </div>
      )}
      {run.status === 'RUNNING' && (
        <div className="panel progress">This run has not finished.</div>
      )}

      {run.warnings.length > 0 && (
        <section>
          <h2>Warnings ({run.warnings.length})</h2>
          <ul className="warnings">
            {run.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      {(run.status === 'CONSISTENT' || run.status === 'VIOLATIONS_FOUND') && (
        <section>
          <h2>Findings ({run.findings.length})</h2>
          {run.findings.length === 0 ? (
            <EmptyState title="No violations">
              <p>Every enabled rule holds in both the declared and the live configuration.</p>
            </EmptyState>
          ) : (
            <>
              <div className="filters">
                <label>
                  Environment
                  <select value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                    <option value={ALL}>All</option>
                    {environments.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Severity
                  <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                    <option value={ALL}>All</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </label>
                <label>
                  Representation
                  <select value={representation} onChange={(e) => setRepresentation(e.target.value)}>
                    <option value={ALL}>All</option>
                    <option value="DECLARED">Declared (Git)</option>
                    <option value="LIVE">Live (cluster)</option>
                  </select>
                </label>
                {filtered && (
                  <span className="muted">
                    Showing {visible.length} of {run.findings.length}
                  </span>
                )}
              </div>
              {visible.length === 0 ? (
                <EmptyState title="No findings match these filters" />
              ) : (
                <table className="data findings">
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Rule</th>
                      <th>Environment</th>
                      <th>Representation</th>
                      <th>Resource</th>
                      <th>Property</th>
                      <th>Expected</th>
                      <th>Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((f) => (
                      <tr key={f.id}>
                        <td><SeverityBadge severity={f.severity} /></td>
                        <td><code>{f.rule}</code></td>
                        <td>{f.environment}</td>
                        <td>{f.representation === 'DECLARED' ? 'declared' : 'live'}</td>
                        <td>{f.kind}/{f.name}</td>
                        <td><code>{f.property}</code></td>
                        <td>{f.expected}</td>
                        <td>{f.observed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
