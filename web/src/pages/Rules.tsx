// Rules: every stored rule with its kind, severity and description, and a switch to
// enable or disable it (PATCH /api/rules/:name).

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage, Rule, RuleKind } from '../api';
import { EmptyState, ErrorState, Loading, SeverityBadge } from '../components';

const KIND_LABEL: Record<RuleKind, string> = {
  FIXED_CONDITION: 'Fixed condition',
  SAME_VALUE: 'Same value',
  RELATIONSHIP: 'Relationship',
};

export function Rules() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api.rules().then(setRules).catch(setError);
  }, []);
  useEffect(load, [load]);

  async function toggle(rule: Rule) {
    setSaving(rule.name);
    setSaveError(null);
    try {
      const updated = await api.setRuleEnabled(rule.name, !rule.enabled);
      setRules((current) => current?.map((r) => (r.name === updated.name ? updated : r)) ?? null);
    } catch (e) {
      setSaveError(`Could not update ${rule.name}: ${errorMessage(e)}`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Rules</h1>
      </div>
      <p className="muted">
        Disabled rules are kept but skipped by the next run. Differences that no rule covers are
        permitted.
      </p>
      {saveError && (
        <div className="state error" role="alert">
          <p>{saveError}</p>
        </div>
      )}
      {error !== null ? (
        <ErrorState error={error} retry={load} />
      ) : rules === null ? (
        <Loading what="rules" />
      ) : rules.length === 0 ? (
        <EmptyState title="No rules in the database">
          <p>Seed them from rules/rules.yaml with: npx prisma db seed</p>
        </EmptyState>
      ) : (
        <table className="data rules">
          <thead>
            <tr>
              <th>Enabled</th>
              <th>Rule</th>
              <th>Kind</th>
              <th>Severity</th>
              <th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id} className={rule.enabled ? '' : 'disabled'}>
                <td>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      disabled={saving !== null}
                      onChange={() => toggle(rule)}
                      aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                    />
                    <span>{saving === rule.name ? 'Saving...' : rule.enabled ? 'On' : 'Off'}</span>
                  </label>
                </td>
                <td>
                  <code>{rule.name}</code>
                  {rule.description && <div className="muted">{rule.description}</div>}
                </td>
                <td>{KIND_LABEL[rule.kind]}</td>
                <td><SeverityBadge severity={rule.severity} /></td>
                <td className="rule-check">
                  <div>
                    {rule.resource} <code>{rule.property}</code>
                  </div>
                  <div>
                    condition <code>{rule.condition}</code>
                  </div>
                  <div className="muted">
                    {rule.environments.length === 0 ? 'all environments' : rule.environments.join(', ')}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
