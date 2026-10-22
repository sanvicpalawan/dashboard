# MerQato Command Center

**Local businesses. Distinct digital worlds.**

A self-hosted agency operating system for **Palawan Collective + MerQato.digital**: clients, projects, websites, service pricing, finance, operations, configurable dashboards, themes, users, RBAC, audit events, and verified API integrations.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, route handlers, `instrumentation.ts`) |
| UI | React 19, TypeScript 5.9, Tailwind CSS 4 (PostCSS), Lucide icons, `motion` |
| Dashboard grid | Dnd Kit (`@dnd-kit/core`, `sortable`, `utilities`) with persisted shared layouts and per-user overrides |
| Database | PostgreSQL via Drizzle ORM 0.45 + drizzle-kit migrations (checked-in SQL, 3 migrations) |
| Validation | Zod 4 |
| Auth and security | Database-backed revocable HTTP-only cookie sessions, scrypt passwords, SHA-256 session tokens, AES-GCM encrypted secrets, server-enforced RBAC and workspace scoping |
| Infra | Standalone Docker image (non-root, port 3000), Docker Compose, Coolify/UpCloud deployment, `/api/health`, optional `AUTO_MIGRATE` startup migrations |
| Ops tooling | `scripts/backup.sh`, `restore.sh`, `verify-backup.sh` (pg_dump custom format + SHA-256), ESLint 9 |
| Integrations | Native `fetch` provider adapters: GitHub, Vercel, Coolify, Cloudflare, InvoiceShelf, OpenCode, OpenRouter, Ollama, UpCloud |

## Code tree

```text
merqato-agency-operating-system/
├── README.md · docs/integrations.md
├── package.json · tsconfig.json · next.config.ts · eslint.config.mjs · postcss.config.mjs
├── Dockerfile · docker-compose.yml · .dockerignore · .env.example · drizzle.config.ts
├── drizzle/
│   ├── 0000_groovy_jetstream.sql · 0001_keen_slapstick.sql · 0002_sturdy_stick.sql
│   └── meta/                       # migration snapshots + journal
├── scripts/                        # backup.sh · restore.sh · verify-backup.sh
├── public/brand.svg
└── src/
    ├── instrumentation.ts          # optional startup migrations
    ├── app/
    │   ├── layout.tsx · globals.css · responsive.css
    │   ├── login/page.tsx
    │   ├── (workspace)/            # main app shell
    │   │   ├── page.tsx            # dashboards + persistent visual grid editor
    │   │   ├── layout.tsx · loading.tsx · error.tsx
    │   │   ├── clients/ · projects/[id]/ · websites/ · leads/
    │   │   ├── services/ · finance/ · operations/
    │   │   ├── tools/[id]/ · appearance/
    │   │   └── admin/              # overview · dashboards · widgets · users ·
    │   │                           # integrations · settings · appearance · audit
    │   └── api/
    │       ├── auth/login · auth/logout · health · search · directory · notifications
    │       ├── dashboards/         # CRUD · layout · widgets · assignments · actions · import
    │       ├── admin/              # users · roles/[id] · sessions/[id] · settings ·
    │       │                       # appearance · widgets/[key]
    │       ├── integrations/[key] · widgets/data · widget-instances/[id]
    │       ├── records/[resource] · projects/[id] · leads(+export) · operations
    │       ├── tools/[id](/files/[fileId]) · uploads/[id] · websites/check
    │       └── themes · preferences · webhooks/github
    ├── components/                 # app-shell · dashboard-grid · dashboard-manager ·
    │                               # widget-view/-types/-manager · integration-manager ·
    │                               # user-manager · theme-gallery · lead-generation ·
    │                               # operations-module · resource-module · project-detail ·
    │                               # tools-catalog · tool-detail · login-form · module-tabs ·
    │                               # admin-nav · global-settings
    ├── db/                         # schema.ts · index.ts · bootstrap.ts (admin/demo seed)
    └── lib/                        # auth · permissions · security · audit · dashboards ·
                                    # integrations + integration-service · leads · themes ·
                                    # widget-registry · widget-data · module-config ·
                                    # tool-schema · utils
```

## Stack and environment capabilities

- Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4.
- PostgreSQL with Drizzle ORM, foreign keys, unique constraints, indexes and checked-in SQL migrations.
- Database-backed, revocable HTTP-only cookie sessions. Passwords use scrypt; session tokens are SHA-256 hashed.
- Server-enforced workspace scoping and role permissions. Financial, integration, credential and deployment permissions are separate.
- Dnd Kit grid editing with persisted shared layouts and per-user overrides.
- Native `fetch` provider adapters; no mandatory proprietary runtime or paid dashboard dependency.
- Standalone Docker image, Compose configuration, `/api/health`, optional startup migrations and Coolify deployment support.

The supplied environment supports Next.js, local PostgreSQL, server route handlers, TypeScript and production builds. It does not provide an external identity provider, email transport, persistent background worker, production VPS, DNS account, or preconfigured third-party credentials. Those capabilities are not claimed.

## First run

Requirements: Node.js 22+, PostgreSQL 16+ and npm.

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Set `DATABASE_URL`, `BOOTSTRAP_ADMIN_EMAIL`, a strong `BOOTSTRAP_ADMIN_PASSWORD`, and `CREDENTIAL_ENCRYPTION_KEY` (`openssl rand -base64 48`).
3. Install with `npm ci`.
4. Apply migrations with `npx drizzle-kit migrate` (or `npx drizzle-kit push` during local schema development).
5. Start with `npm run dev`, or build and start with `npm run build && npm run start`.
6. Open `/login`. The administrator record is created only when the user table is empty. In demo/development mode, use **Continue as administrator**. Email authentication and a production identity flow are intentionally deferred; do not expose the passwordless demo flow publicly.

### Demo mode

`DEMO_MODE=true` seeds a **clearly labeled fictional Palawan agency workspace**. During the current build phase, email/password authentication is intentionally removed. Demo mode opens `/` directly with the demo administrator context, including when a browser has no usable session cookie. **Continue as administrator** remains available after sign-out and creates a normal database-backed session. This development access is disabled when `DEMO_MODE=false` and must not be exposed publicly. Integration providers still start disconnected and never return fabricated provider data.

Use `DEMO_MODE=false` before production bootstrap. To remove an existing demo workspace, restore an empty database or deliberately delete the demo records; changing the flag does not silently delete business data.

## Application map

- `/` — assigned dashboards and the persistent visual grid editor.
- `/clients`, `/projects`, `/websites` — operational records, tasks, deliverables and availability checks.
- `/services`, `/finance`, `/operations` — catalog pricing, invoices/subscriptions/expenses, incidents, automation runs and jobs.
- `/appearance` — live theme preview, personal accent/density, notifications and default dashboard.
- `/admin` — verified counts, health, sync failures and configuration issues.
- `/admin/dashboards` — lifecycle, assignments, import/export, publish, rollback and visual builder.
- `/admin/widgets` — modular registry, policies, defaults and data-contract tests.
- `/admin/users` — provisioning, activation, teams, roles, password resets and session revocation.
- `/admin/integrations` — official provider setup, status, credentials, test, sync and history.
- `/admin/settings` — branding, navigation, policy, locale, schedules, maintenance and outbound allowlist.
- `/admin/audit` — append-only activity, security checks and rotation/backup guidance.

## Docker and Coolify on UpCloud

### Docker Compose

1. Create a GitHub repository and push this complete source tree. Do not commit `.env`, dumps or credentials.
2. On the UpCloud VPS, install Docker and Coolify using their official documentation. Restrict Coolify and SSH with firewall rules.
3. Copy `.env.example` into Coolify's environment configuration (never into the image) and set strong secrets.
4. For a Compose deployment, use `docker-compose.yml`. PostgreSQL data is stored in `merqato_postgres`; only the app publishes a port.
5. For a single Coolify application plus a managed Coolify PostgreSQL database, use the `Dockerfile` and set `DATABASE_URL` to that private database service.
6. Keep `AUTO_MIGRATE=true` for the initial single-replica deployment. Checked-in migrations run through `instrumentation.ts`. Run only one replica during migration; disable the flag afterward if you prefer an explicit migration step.
7. Set the Coolify health check to `GET /api/health`. Put Cloudflare in front of the Coolify public hostname and keep `COOKIE_SECURE=true`.
8. Verify first login, create a non-super test account, and review **Admin → Audit** before connecting production providers.

The app listens on port 3000 as a non-root user. The image contains no `.env` file. Basic functionality requires only the app and PostgreSQL; Vercel, OpenRouter, UpCloud, Cloudflare paid features and other providers are optional and may incur usage charges.

### Update

1. Back up PostgreSQL and record the current Git commit/image.
2. Review changes and migration compatibility in GitHub.
3. Deploy the reviewed commit through Coolify with one application replica.
4. Wait for migrations and `/api/health`, then verify login, dashboard layout and critical writes.
5. Check integration test/sync states; a provider failure must not block application health.

### Rollback

Roll back the Coolify deployment to the previous known-good image. If a destructive migration was applied, restore the matching pre-update backup into a separate database, verify it, then switch `DATABASE_URL`. Never assume an old application image is compatible with a newer schema.

## Backup and restore

`scripts/backup.sh` creates a PostgreSQL custom-format dump and SHA-256 file. `scripts/restore.sh` requires `TARGET_DATABASE_URL`, `BACKUP_FILE`, and typed confirmation. `scripts/verify-backup.sh` creates a temporary database, restores into it, checks core table counts, and drops it.

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/merqato'
sh ./scripts/backup.sh

export POSTGRES_ADMIN_URL='postgresql://postgres:PASSWORD@HOST/postgres'
export BACKUP_FILE='./backups/merqato-TIMESTAMP.dump'
sh ./scripts/verify-backup.sh
```

Store dumps encrypted off-VPS. Schedule the backup script with a Coolify scheduled task, not the web request process. A backup is only considered verified after the separate restore test passes. The interface reports recorded backup jobs; it does not claim a backup succeeded without that record. These scripts are supplied for the target PostgreSQL environment; no off-site production backup has been performed by this source build.

## Security model

- Every API checks session, role permission and workspace ownership; hidden buttons are not authorization.
- Super Administrator retains `*`; other built-in roles have configurable least-privilege grants. Client Viewer is intentionally restricted until a portal exists.
- Credential writes require `credentials.manage`; financial and deployment permissions are distinct.
- Secrets are AES-GCM encrypted, excluded from browser responses, and scrubbed from audit metadata. Do not put secrets in notes, widget settings or URLs.
- Login, widget reads and sensitive actions have validation and rate limits. Add Coolify/Cloudflare rate limits for multi-instance production defense.
- Custom widgets use registered React/server contracts only. Arbitrary uploaded JavaScript/HTML is not executed. Remote JSON/RSS requires host allowlisting, timeouts and response limits; private/loopback targets are rejected.
- Destructive dashboard, record, credential, rollback and job actions require explicit confirmation.
- Audit events are append-only through application APIs. Restrict direct database mutation to trusted operators.

## Provider setup and limitations

See **[docs/integrations.md](docs/integrations.md)** for exact scopes, endpoints, charges and troubleshooting.

Implemented read/test/sync adapters: GitHub, Vercel, Coolify, Cloudflare, version-probed InvoiceShelf, OpenCode server health/session status, OpenRouter account data, Ollama model inventory and UpCloud server inventory. All failures are visible and cached data is marked stale. InvoiceShelf mappings must be verified against the installed version. OpenCode has no assumed universal remote-control API and no execution action is enabled. Hermes is neither included nor required.

Not currently claimed: arbitrary integrations without development, automatic email invitations, arbitrary custom-code widgets, universal deployment/DNS writes, guest VPS CPU/RAM metrics without a monitoring source, automatic off-site backups, or a persistent scheduled-sync worker inside the web process. Manual sync and registered integration-job retry are implemented; scheduled jobs need an external worker.

## Acceptance verification guide

Run these against a non-production workspace and record actual results:

1. Create a dashboard in `/admin/dashboards`, add a registry widget, publish it, reload, sign out/in and confirm layout persistence.
2. Drag, resize, configure, duplicate, hide/restore and remove widgets; export/import JSON and restore a prior version.
3. As a read-only user, call admin and record-mutation APIs directly and expect 403; request an unassigned dashboard and expect 404.
4. Apply a theme, reload, and confirm both user preference and administrator fallback behavior.
5. Enter an invalid provider credential and confirm an error state, sync failure record and responsive application with no fake data.
6. Disconnect a provider and confirm its widgets show disconnected rather than cached live data.
7. Inspect browser responses and logs for password hashes, session tokens, authorization headers and integration credentials.
8. Deploy from a clean Git commit using documented environment placeholders.
9. Run `scripts/verify-backup.sh` against a dump and a separate temporary PostgreSQL database before relying on the procedure.

## Useful commands

```sh
npm run typecheck
npx next typegen
npm run build
npx drizzle-kit generate
npx drizzle-kit migrate
```
