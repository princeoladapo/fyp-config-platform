# Cross-Environment Configuration Consistency Validation Platform

Final year project (BSc Computer Science, Adeleke University), built by Dapo with a group partner.
Dapo is new to this tooling: explain steps plainly, one at a time, and give exact commands for
Windows Command Prompt (cmd), not PowerShell or bash, unless told otherwise.

## What the platform does

It checks whether the development, staging and production environments of a Kubernetes app are
consistent with one another according to user-defined rules. It is NOT a diff tool: differences
that no rule covers are treated as permitted (e.g. LOG_LEVEL=debug in development is fine).

The central idea is **cross-environment comparison**, applied over two representations of each
environment:
- **declared**: what is committed in Git (manifests in each environment's directory)
- **live**: what is actually running in the Kubernetes namespace

These are not two separate validation modes; every rule runs over both, and each finding records
which representation it was observed in.

## Scope (agreed, do not expand)

- Sources: **Git and Kubernetes only**.
- Resource kinds: **Deployment, Service, ConfigMap** only.
- Out of scope / future work: Terraform and other IaC, Helm, Argo CD, cloud provider config,
  multi-user auth and roles, automatic remediation.
- Single actor: Platform User (DevOps Engineer). Prototype runs as a single local user.
- The platform is read-only against Git and the cluster. It must never modify either.

## Design references (Chapter Three of the project report)

- 3.2 Incremental model. Increments in order:
  1. Rules engine on sample data (DONE)
  2. Git connector (DONE)
  3. Kubernetes connector (NEXT)
  4. Rule and template definition stored in the database
  5. Reporting interface and persistence of findings
- 3.6.2 Environment mapping: one Git directory per environment, paired with the namespace of the
  same name. Held in config/environments.yaml for now; the database `environments` table later.
- 3.6.5 Normalized record: `(environment, representation, kind, name, property, value)`.
  Only user-configurable sections are kept: `spec`, `data`, `metadata.labels`. Server-managed
  fields (status, managedFields, resourceVersion, uid, timestamps) are excluded.
- 3.6.6 Rule semantics:
  - Paths are dot-separated; `[*]` matches every array index.
  - Fixed condition (`">= 3"`, `"== true"`, `"startsWith(x)"`): checked per listed environment.
  - `same`: value must match across the listed environments; most common value is expected,
    ties go to the first listed environment.
  - Relational (`"production >= staging"`): compares the same property between two environments.
  - A property missing from an environment where the resource exists is a finding ("absent").
- 3.6.8 Security: Git read access only; cluster access via a service account with only `get` and
  `list` on the three resource kinds in the three namespaces. Credentials via environment
  variables, never stored in the database or reports.
- 3.8 Evaluation: drift-injection scenarios; metrics are detection rate, false-positive rate on
  permitted differences, severity accuracy, and run time (target under 60 seconds).

## Code layout

```
src/engine/types.ts            shared types (NormalizedRecord, RuleDefinition, EngineFinding)
src/engine/rulesEngine.ts      evaluate(records, rules, environments) -> findings
src/normalization/normalize.ts normalizeResource(resource, env, representation) -> records
src/connectors/gitConnector.ts reads committed YAML per environment (default ref HEAD)
src/config.ts                  loads config/environments.yaml
src/demo.ts                    runs a full validation and prints findings
config/environments.yaml       environment mapping
rules/rules.yaml               validation rules
sample-config/environments/*/  sample manifests for development, staging, production
fixtures/live-records.json     FAKE live data, to be replaced by the Kubernetes connector
prisma/schema.prisma           database schema (5 tables, see below)
```

Run the demo with: `npx tsx src/demo.ts` (expected today: 8 violations).

Important: the Git connector reads what is **committed**, not unsaved edits. Commit manifest
changes before running, or the connector will not see them.

## Local environment (Windows 11 + WSL2 + Docker Desktop)

- Node v22, Git 2.42, kind v0.33, kubectl v1.36.
- kind cluster `fyp-cluster` (kubectl context `kind-fyp-cluster`), namespaces `development`,
  `staging`, `production`. Each runs `web-app` (nginx) with 1, 2 and 3 replicas.
  Note: the live cluster currently runs plain `nginx` images, not the sample manifests. Applying
  the sample manifests to the cluster is part of increment three.
- PostgreSQL in Docker container `fyp-postgres`, database `fyp_config_platform`, port 5432.
  Connection string is in `.env` (DATABASE_URL).
- If Docker Desktop was closed, start it first; the cluster and database run inside it.

## Database (Prisma 7.10)

- Prisma 7 layout: connection URL lives in `prisma7.config.ts`, not in schema.prisma.
  The client is generated to `generated/prisma` and needs the `@prisma/adapter-pg` driver adapter
  (`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`) and `dotenv`.
- Stay on Prisma 7. Do not upgrade to Prisma 8 (release candidate, breaking changes).
- Tables: environments, rules, templates, validation_runs, findings. Migration `init` applied.
- The schema adds three things the report's ERD (Figure 3.4) does not show yet; the report needs
  updating to match: `rules.environments`, `findings.resource_kind`, and `findings.rule_id` is
  nullable (a finding can come from a template instead of a rule).

## Next step: increment three, Kubernetes connector

- Use the official client `@kubernetes/client-node`.
- For each mapped environment, list Deployments, Services and ConfigMaps in its namespace, pass
  each through `normalizeResource(..., 'live')`, and replace fixtures/live-records.json in demo.ts.
- Watch for server-defaulted fields in live objects (e.g. strategy, imagePullPolicy,
  terminationMessagePath) and the auto-created `kube-root-ca.crt` ConfigMap in every namespace.
  These appear in all environments so they rarely break cross-environment rules, but decide
  deliberately whether to filter them.
- Set up the read-only service account from 3.6.8 before relying on it.
- Consider applying sample-config manifests to the cluster so declared and live start from the
  same place, then inject drift for the 3.8 scenarios.

## Known housekeeping

- `npm audit` reports 4 high severity issues in dev dependencies. Do not run
  `npm audit fix --force`; it can break package versions.
- `.claude/`, `.windsurf/`, `.agents/` folders and `skills-lock.json` were created by `prisma init`.

## Writing style for any report text

When writing chapter text, emails or documentation for Dapo, avoid patterns that make writing read
as AI-generated: stock words (delve, pivotal, robust, leverage, landscape, underscore), vague
attribution ("studies show"), reflexive lists of three, "not just X, it's Y", summary paragraphs
that repeat what was said, heavy em dashes, emojis, and lists whose last item is a different kind
of thing from the rest. Name real sources and tools; vary sentence length.
