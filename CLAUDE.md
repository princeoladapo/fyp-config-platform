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
  3. Kubernetes connector (DONE)
  4. Rules stored in the database (DONE)
  5. Reporting interface and persistence of findings (NEXT)
- 3.6.2 Environment mapping: one Git directory per environment, paired with the namespace of the
  same name. Held in config/environments.yaml, which the demo still reads; the seed copies it
  into the database `environments` table, which the rule repository checks rules against.
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
src/connectors/k8sConnector.ts reads live Deployments, Services, ConfigMaps per namespace
src/config.ts                  loads config/environments.yaml
src/db.ts                      createPrismaClient(): PrismaClient + PrismaPg adapter, DATABASE_URL from .env
src/rules/ruleKind.ts          ruleKindOf(condition): FIXED_CONDITION / SAME_VALUE / RELATIONSHIP
src/rules/ruleRepository.ts    loadEnabledRules(prisma) -> RuleDefinition[], validates each rule first
src/rulesCli.ts                rules CLI: list | enable <name> | disable <name>
src/demo.ts                    runs a full validation (rules from the database) and prints findings
config/environments.yaml       environment mapping and kubeContext (fyp-readonly)
rules/rules.yaml               validation rules: the seed source, not read by the demo
prisma/seed.ts                 upserts rules.yaml and environments.yaml into the database by name
sample-config/environments/*/  sample manifests for development, staging, production
k8s/rbac.yaml                  read-only service account, Roles and RoleBindings (3.6.8)
k8s/kind-config.yaml           kind cluster definition (name fyp-cluster, pinned node image)
scripts/setup.ps1              reproducible setup of the whole environment (see SETUP.md)
.env.example                   DATABASE_URL template; setup.ps1 creates .env from it
prisma/schema.prisma           database schema (4 tables, see below)
tsconfig.json                  strict type checking only; tsx runs the code
```

Run the demo with: `npx tsx src/demo.ts`. It prints "Loaded N rules from the database" (5 on the
baseline). Baseline: **zero findings** (declared and live both match the sample manifests). Any finding now means drift was introduced.

Type check with: `npx tsc --noEmit` (should report nothing).

Kubernetes connector details: it restores the `kind` field that list responses omit, skips the
auto-created `kube-root-ca.crt` ConfigMap, and keeps server-defaulted fields (strategy,
imagePullPolicy, etc.) because rules only check the properties they name.

Important: the Git connector reads what is **committed**, not unsaved edits. Commit manifest
changes before running, or the connector will not see them.

## Local environment (Windows 11 + WSL2 + Docker Desktop)

- Node v22.23 (22.19+ required), Git 2.42, kind v0.33, kubectl v1.36.
- kind cluster `fyp-cluster` (admin kubectl context `kind-fyp-cluster`), namespaces
  `development`, `staging`, `production`. Each runs the sample manifests: `web-app` with 1, 2 and
  3 replicas, a `web-app` Service, and a `web-config` ConfigMap.
- The images `registry.example.com/web-app:dev` and `:v2` are local copies of
  `nginxinc/nginx-unprivileged`, which runs as a non-root user and listens on port **8080**
  (containerPort and Service targetPort are 8080; the Service port is 80). The registry does
  not exist; the images are loaded straight into kind, and imagePullPolicy defaults to
  IfNotPresent because the tags are not `latest`.
- Loading images into kind: `kind load docker-image` fails on Docker Desktop with
  `content digest ... not found` (multi-platform images under the containerd image store).
  Export only the amd64 build and load the archive instead:
  ```
  docker save --platform linux/amd64 -o web-app-images.tar registry.example.com/web-app:dev registry.example.com/web-app:v2
  kind load image-archive web-app-images.tar --name fyp-cluster
  del web-app-images.tar
  ```
- Read-only access (3.6.8): `k8s/rbac.yaml` creates ServiceAccount `config-validator` in its own
  namespace `config-validator`, and in each environment namespace a Role `config-validator-read`
  (only `get` and `list` on deployments, services, configmaps) with a RoleBinding to that
  account. The platform reads the cluster through kubeconfig context `fyp-readonly`, which uses
  the account's token. Verified with `kubectl auth can-i ... --context fyp-readonly`: it can get
  and list the three kinds, and cannot create, update, patch or delete them, read Secrets, or
  read other namespaces.
- The token is stored in the local kubeconfig (`%USERPROFILE%\.kube\config`, or the file named
  by the `KUBECONFIG` environment variable), never in the repository or database. It expires
  after 30 days (current one: 4 December 2026). If the demo reports `Unauthorized`, renew it in
  cmd:
  ```
  for /f %t in ('kubectl create token config-validator -n config-validator --duration=720h --context kind-fyp-cluster') do @kubectl config set-credentials config-validator --token=%t
  ```
- Rebuilding the environment (or setting it up on another machine): run
  `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`. It checks prerequisites, creates
  the cluster from `k8s/kind-config.yaml`, loads the images (detecting amd64/arm64), applies the
  manifests and RBAC, renews the token and `fyp-readonly` context, starts PostgreSQL, runs
  `npm ci`, `prisma migrate deploy` and `prisma db seed`, and checks the demo reports zero
  findings. Safe to re-run.
  Tested from a fresh clone on 4 November 2026 (about 7 minutes from scratch). SETUP.md is the
  guide for a new Windows 11 machine.
- PostgreSQL in Docker container `fyp-postgres`, database `fyp_config_platform`, port 5432.
  Connection string is in `.env` (DATABASE_URL).
- If Docker Desktop was closed, start it first; the cluster and database run inside it.

## Database (Prisma 7.10)

- Prisma 7 layout: connection URL lives in `prisma7.config.ts`, not in schema.prisma.
  The client is generated to `generated/prisma` and needs the `@prisma/adapter-pg` driver adapter
  (`new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`) and `dotenv`.
- Stay on Prisma 7. Do not upgrade to Prisma 8 (release candidate, breaking changes).
- Tables: environments, rules, validation_runs, findings. Migrations `init`, `drop_templates` and
  `add_rule_kind_and_description` applied. Every finding references a rule (`findings.rule_id` is
  required).
- `rules` columns: name (unique), kind (enum RuleKind: FIXED_CONDITION, SAME_VALUE, RELATIONSHIP,
  the report's terms), description (optional), resource, property, environments (empty array =
  all environments; the relationship rule uses this), condition, severity, enabled (default true).
- Seed: `npx prisma db seed` (configured as `migrations.seed` in prisma7.config.ts; Prisma 7 does
  not read a seed entry from package.json). It works out `kind` from the condition, matches on name,
  and leaves `enabled` untouched on existing rules. It does not delete rules removed from the file.
- The rule repository rejects, naming each rule: unknown resource kind, a stored kind that does not
  match the condition, environments missing from the `environments` table, a relationship rule that
  does not name two different known environments, a SAME_VALUE rule with exactly one environment.
- `generated/prisma` is git-ignored: run `npx prisma generate` after changing the schema.

## Next step: increment five, reporting interface and persistence of findings

- Save each run to `validation_runs` and its findings to `findings` (each with rule_id and
  environment_id from the database rows, and the representation).
- A reporting interface over stored runs (fastify is already a dependency).
- The 3.8 drift-injection scenarios can be run against the zero-finding baseline: change a
  manifest (declared) or the cluster (live, using the admin context), run the demo, record
  what is detected, then restore the baseline. Verified for increment four: scaling production
  to 1 replica gives HIGH production-minimum-replicas and MEDIUM
  production-replicas-not-below-staging (both live); disabling the first with the CLI leaves
  only the MEDIUM one.

## Known housekeeping

- `npm audit` reports 4 high severity issues in dev dependencies. Do not run
  `npm audit fix --force`; it can break package versions.
- `@kubernetes/client-node` pulls in `undici`, which needs Node 22.19 or newer; setup.ps1
  enforces this.
- `.claude/`, `.windsurf/`, `.agents/` folders and `skills-lock.json` were created by `prisma init`.

## Writing style for any report text

When writing chapter text, emails or documentation for Dapo, avoid patterns that make writing read
as AI-generated: stock words (delve, pivotal, robust, leverage, landscape, underscore), vague
attribution ("studies show"), reflexive lists of three, "not just X, it's Y", summary paragraphs
that repeat what was said, heavy em dashes, emojis, and lists whose last item is a different kind
of thing from the rest. Name real sources and tools; vary sentence length.
