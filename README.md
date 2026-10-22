# Palawan Collective Command Center

**Local businesses. Distinct digital worlds.**

A self-hosted agency operating system for **Palawan Collective** and **merQato.digital** — clients,
projects, websites, service pricing, finance, operations, configurable dashboards, themes, users,
RBAC, audit events and verified API integrations.

Built in Palawan, deployed on Neon Postgres. No third-party dashboard or low-code runtime is
required to run it.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router, route handlers, `instrumentation.ts`) |
| UI | React 19, TypeScript 5.9, Tailwind CSS 4 (PostCSS), Lucide icons, motion (Framer) |
| Dashboard grid | `@dnd-kit` (core / sortable / utilities) with persisted shared layouts + per-user overrides |
| Database | **Neon Postgres 18** — pooled `-pooler` endpoint for traffic, direct endpoint for migrations — via Drizzle ORM 0.45 + drizzle-kit (4 checked-in SQL migrations) |
| Validation | Zod 4 |
| Auth / security | DB-backed revocable HTTP-only cookie sessions, scrypt passwords, SHA-256 session tokens, AES-GCM encrypted secrets, RBAC with server-enforced workspace scoping |
| Infra | Docker (standalone image, non-root, port 3000), docker-compose (app + local `merqato_postgres` volume for offline work), Coolify/UpCloud deploy docs, `/api/health`, optional `AUTO_MIGRATE` |
| Ops tooling | `scripts/backup.sh` / `restore.sh` / `verify-backup.sh` (pg_dump custom format + SHA-256), `backup-json.mjs` (logical JSON dump + FK-safe restore), `set-admin-password.mjs`, `cleanup-demo-data.mjs`, `import-prospects.mjs`, ESLint 9 |
| Integrations | Native `fetch` provider adapters: GitHub, Vercel, Coolify, Cloudflare, InvoiceShelf, OpenCode, OpenRouter, Ollama, UpCloud |

---

## Getting started

### 1. Neon database

The project is linked to the Neon project named `dashboard`
(`org-rough-haze-98678005` / `icy-thunder-63019822`, branch `production`, region
`aws-ap-southeast-1`).

```sh
npm i -g neon@latest                 # or prefix every command with npx neon@latest
neon init -y --org-id org-rough-haze-98678005 \
  --project-id icy-thunder-63019822 \
  --branch production --services postgres
neon deploy                          # provisions neon.ts services, pulls env vars
```

`neon deploy` writes `.env.local` with:

| Variable | Use |
|---|---|
| `DATABASE_URL` | pooled (`-pooler`) endpoint — application traffic |
| `DATABASE_URL_UNPOOLED` | direct endpoint — migrations, dumps, anything holding session state |
| `NEON_BRANCH` | branch name this checkout is linked to |

The Neon agent skills used during setup are vendored in `.agents/skills/` (`neon`,
`neon-postgres`). Key rule taken from them: **the application uses the pooled URL, migrations use
the direct URL.** Running Drizzle Kit against the pooler produces misleading errors such as
`prepared statement "s0" already exists`.

### 2. Environment

```sh
cp .env.example .env.local      # then fill the remaining secrets
openssl rand -base64 48         # CREDENTIAL_ENCRYPTION_KEY / AUTH_SECRET
```

Required: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `BOOTSTRAP_ADMIN_EMAIL`, a strong
`BOOTSTRAP_ADMIN_PASSWORD`, `CREDENTIAL_ENCRYPTION_KEY`, `AUTH_SECRET`.

### 3. Install, migrate, run

```sh
npm ci
npm run db:migrate              # Drizzle Kit over DATABASE_URL_UNPOOLED
npm run dev                     # http://localhost:3000
# or
npm run build && npm start
```

`AUTO_MIGRATE=true` also applies the checked-in migrations at server start (via
`src/instrumentation.ts`, using the direct URL). Keep it enabled for the first single-replica
deploy, then disable it once migrations are part of your release step.

### 4. First login

Sign-in is email + password against the `users` table (scrypt hashes, rate-limited, DB-backed
sessions, audited). The administrator record is created only when the user table is empty and needs
`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`; otherwise rotate an existing account with:

```sh
node scripts/set-admin-password.mjs --email admin@merqato.local --out C:\dev\merqato\.secrets\admin-initial-password.txt
```

The password is written to `--out` (must be outside the repo), never printed. Move it into a password
manager and delete the file.

`DEMO_MODE` is opt-in: only `DEMO_MODE=true` enables the passwordless "Continue as administrator"
button and the fictional seed records. Unset, misspelled or `false` means real-use mode, and
`/api/auth/login` refuses `{"access":"local-workspace"}` with 403.

### 5. Data maintenance

| Script | Purpose |
|---|---|
| `node scripts/backup-json.mjs <file.json>` | logical dump of every public table - write it outside the repo |
| `node scripts/backup-json.mjs --restore <file.json> --force` | truncate and reload in foreign-key order; verify on a Neon branch, never on live data |
| `node scripts/cleanup-demo-data.mjs [--apply]` | dry-run or delete only the rows created by the demo seed functions |
| `node scripts/import-prospects.mjs --file <csv> [--apply]` | create-only lead import with dedupe, review flags and a JSON report |
| `node scripts/set-admin-password.mjs --email <address> --out <file>` | rotate an account password |

`npm test` runs the unit tests plus live API checks against `DASHBOARD_URL` (default
`http://localhost:3100`). Set `DASHBOARD_ADMIN_EMAIL` / `DASHBOARD_ADMIN_PASSWORD` to exercise real
password sign-in; otherwise the suite creates a short-lived session row directly.

---

## Code tree

```
dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx                 # root metadata, icons, theme color
│   │   ├── globals.css                # design tokens, shell, components
│   │   ├── responsive.css             # breakpoint overrides
│   │   ├── icon.png, apple-icon.png   # Palawan Collective favicons
│   │   ├── login/page.tsx             # brand panel + workspace entry
│   │   ├── (workspace)/               # authenticated app shell + pages
│   │   │   ├── layout.tsx             # loads theme, branding, notifications
│   │   │   ├── page.tsx               # overview dashboards
│   │   │   ├── clients|projects|websites|services|finance|
│   │   │   │   operations|leads|appearance|tools/…  # module pages
│   │   │   └── admin/                 # dashboards, widgets, users, integrations,
│   │   │                              # settings, appearance, audit
│   │   └── api/                       # route handlers (auth, records, dashboards,
│   │                                  # integrations, tools, uploads, webhooks, health)
│   ├── components/                    # app shell, dashboard grid, module UIs,
│   │                                  # brand-logo.tsx (Palawan Collective mark)
│   ├── db/
│   │   ├── index.ts                   # Neon-aware pg pool + Drizzle client
│   │   ├── schema.ts                  # 42 tables, relations, constraints
│   │   └── bootstrap.ts               # idempotent seed: roles, themes, widgets, demo data
│   ├── lib/                           # auth, permissions, security, integrations,
│   │                                  # widget registry/data, themes, module config
│   └── instrumentation.ts             # startup migrations over the direct URL
├── drizzle/                           # generated SQL migrations + snapshots
├── docs/integrations.md               # provider scopes, endpoints, charges
├── public/brand/                      # Palawan Collective mark, lockup, icons
├── scripts/                           # backup, restore, verify-backup
├── neon.ts                            # Neon service/branch policy
└── .agents/skills/                    # neon + neon-postgres agent skills
```

---

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

## Branding

Brand assets live in `public/brand/` (white turtle mark and lockup, designed for the `#0b0c10`
surface) and `src/app/icon.png` / `src/app/apple-icon.png` for favicons. Application name, co-brand,
brand mark and optional logo/favicon URLs are editable at **Admin → Settings → Branding**; the
bundled Palawan Collective assets are the fallback when no logo URL is set. Theme colors are
editable at **Admin → Appearance**.

## Docker and Coolify on UpCloud

### Docker Compose

1. Create a GitHub repository and push this complete source tree. Do not commit `.env`, dumps or credentials.
2. On the UpCloud VPS, install Docker and Coolify using their official documentation. Restrict Coolify and SSH with firewall rules.
3. Copy `.env.example` into Coolify's environment configuration (never into the image) and set strong secrets.
4. For a Compose deployment, use `docker-compose.yml`. PostgreSQL data is stored in `merqato_postgres`; only the app publishes a port.
5. For a single Coolify application plus managed Postgres, use the `Dockerfile` and set `DATABASE_URL` / `DATABASE_URL_UNPOOLED` to the managed database.
6. Keep `AUTO_MIGRATE=true` for the initial single-replica deployment. Checked-in migrations run through `instrumentation.ts`. Run only one replica during migration; disable the flag afterward if you prefer an explicit migration step.
7. Set the Coolify health check to `GET /api/health`. Put Cloudflare in front of the Coolify public hostname and keep `COOKIE_SECURE=true`.
8. Verify first login, create a non-super test account, and review **Admin → Audit** before connecting production providers.

The app listens on port 3000 as a non-root user. The image contains no `.env` file. Basic
functionality requires only the app and Postgres; Vercel, OpenRouter, UpCloud, Cloudflare paid
features and other providers are optional and may incur usage charges.

### Update

1. Back up Postgres and record the current Git commit/image.
2. Review changes and migration compatibility in GitHub.
3. Deploy the reviewed commit through Coolify with one application replica.
4. Wait for migrations and `/api/health`, then verify login, dashboard layout and critical writes.
5. Check integration test/sync states; a provider failure must not block application health.

### Rollback

Roll back the Coolify deployment to the previous known-good image. If a destructive migration was applied, restore the matching pre-update backup into a separate database, verify it, then switch `DATABASE_URL`. Never assume an old application image is compatible with a newer schema.

On Neon, the cheaper and faster path is **instant restore** or a branch: `neon branches create --name rollback-<date> --parent <history-timestamp>`, verify on the branch, then repoint the connection strings.

## Backup and restore

`scripts/backup.sh` creates a PostgreSQL custom-format dump and SHA-256 file. `scripts/restore.sh` requires `TARGET_DATABASE_URL`, `BACKUP_FILE`, and typed confirmation. `scripts/verify-backup.sh` creates a temporary database, restores into it, checks core table counts, and drops it.

```sh
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/merqato'
sh ./scripts/backup.sh

export POSTGRES_ADMIN_URL='postgresql://postgres:PASSWORD@HOST/postgres'
export BACKUP_FILE='./backups/merqato-TIMESTAMP.dump'
sh ./scripts/verify-backup.sh
```

Dumps against Neon must use the **direct** (`DATABASE_URL_UNPOOLED`) host, not the `-pooler` one.
Store dumps encrypted off-VPS. Schedule the backup script with a Coolify scheduled task or a Neon
workflow, not the web request process. A backup is only considered verified after the separate
restore test passes. The interface reports recorded backup jobs; it does not claim a backup
succeeded without that record.

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

Implemented read/test/sync adapters: GitHub (multiple independent accounts), Vercel, Coolify, Cloudflare, InvoiceShelf, OpenCode server health/session status, OpenRouter account data, Ollama model inventory and UpCloud server inventory. All failures are visible and cached data is marked stale. Coolify is read-only by design: no deploy, restart or terminal action is exposed. InvoiceShelf requires a bearer token minted from its mobile login endpoint (see `docs/integrations.md`); its web UI has no token screen. OpenCode has no assumed universal remote-control API and no execution action is enabled. Hermes is neither included nor required.

The **Websites** module shows a live column matched by repository URL and domain against synchronized GitHub, Coolify and Vercel data, and names each source as `verified`, `not connected`, `not synchronized` or `error` instead of implying availability. Vercel and Cloudflare tokens must be created once in their dashboards before those sources can report anything.

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
npm run lint
npm run test             # crypto/redaction unit tests + live API checks when the server runs
npm run build
npm run db:generate      # new migration from src/db/schema.ts
npm run db:migrate       # apply migrations (direct Neon URL)
npm run db:studio        # inspect data
neon branches list
neon connection-string --branch production
```
