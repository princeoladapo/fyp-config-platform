// Shared types for the consistency and rules engine.
// These mirror the design in Chapter Three, Sections 3.6.5 and 3.6.6.

export type Representation = 'declared' | 'live';
export type Severity = 'high' | 'medium' | 'low';

// One normalized configuration value:
// (environment, representation, kind, name, property, value)
export interface NormalizedRecord {
  environment: string;
  representation: Representation;
  kind: string;        // e.g. Deployment, Service, ConfigMap
  name: string;        // e.g. web-app
  property: string;    // e.g. spec.replicas
  value: string | number | boolean;
}

// A rule as written in the YAML rules file.
export interface RuleDefinition {
  rule: string;
  resource: string;
  property: string;
  environments?: string[];
  condition: string;
  severity: Severity;
}

// One detected violation.
export interface EngineFinding {
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
