# Spry — PROJECT.md

The structure of the repository: folders, what lives in each one, and the contracts between the
parts. No implementation code. The course template's own reference (stack, configuration, the
items API, deployment) is `README.md`; this file adds the Spry slice on top of it and is the spec
the meetings feature was generated from.

---

## 1. Decision: one repository, not three

Spry is a **monorepo**: backend, frontend, database configuration, infrastructure and CI live in
one tree.

- **Atomic changes.** One commit changes the API and the client that calls it, so the two cannot
  drift apart. A contract change is reviewed as one diff.
- **The repository is the context window.** The endpoint, the ORM model, the migration and the
  component that renders the result are all readable in a single pass. Split across three
  repositories, an agent (or a new teammate) sees a third of the system and guesses the rest — and
  a guessed contract is a bug found at integration time.
- **Trade-off accepted.** A repository boundary buys independent releases and permissions; it costs
  context. For a team of four and a product that does not exist yet, context is worth more. The
  boundary we keep is inside the tree: `backend/` and `frontend/` share no source code, only the
  HTTP contract.

---

## 2. Scope of the first Spry slice

- The backend exposes `GET /api/meetings` (list) and `POST /api/meetings` (create one).
- A meeting has: `id`, `title`, `starts_at`, `ends_at`, `attendee_count`.
- The frontend has one page, `/meetings`, that lists meetings and has a form that adds a new one,
  plus this week's numbers compared with last week.
- `docker compose up --build` is the only command a new developer runs (after Docker Desktop).
- Meetings need **no sign-in** in this slice. Everything the template already had (items, the
  board, the dashboard, Cognito sign-in, AWS deployment) stays as it is.

Deliberately **not** added: editing or deleting meetings, pagination, caches, queues, extra
reverse proxies, a second database.

---

## 3. Repository layout

```
Peach/
├── PROJECT.md                  # this specification
├── README.md                   # template reference: stack, config, items API, deployment
├── .env.example                # every variable Compose and the scripts read
├── docker-compose.yml          # db, backend, frontend
├── docker-compose.override.yml # development only: bind mounts + hot reload (auto-loaded)
├── Makefile                    # thin wrappers over compose and the deploy scripts
├── .github/workflows/          # lint on every push; backend deploy on "deploy" commits
├── infra/                      # CloudFormation: backend (Lambda + Aurora), frontend (S3 +
│                               #   CloudFront), cognito (user pool), github-oidc (CI role)
├── scripts/                    # deploy-*/destroy-* for backend, frontend, cognito; domain; role
│
├── backend/                    # the HTTP API (FastAPI)
│   ├── Dockerfile              # builder / dev / runtime / lambda stages
│   ├── pyproject.toml, uv.lock # dependencies, exact versions committed
│   ├── alembic.ini
│   ├── scripts/entrypoint.sh   # container start: alembic upgrade head, then uvicorn
│   ├── app/
│   │   ├── main.py             # app factory: CORS, /health, routers, database-error handler
│   │   ├── config.py           # Settings from environment variables — nothing else reads env
│   │   ├── db.py               # async engine, session factory, get_session dependency
│   │   ├── auth.py             # Cognito ID-token check → current user (for /api/v1 only)
│   │   ├── lambda_handler.py   # Lambda entry (function URL → Mangum; "migrate" → alembic)
│   │   ├── api/router.py       # /api/v1 (signed in) and /api (public) routers
│   │   ├── api/routes/         # HTTP layer: health, items, me, meetings
│   │   ├── schemas/            # Pydantic models = the wire contract
│   │   ├── services/           # business logic and queries, no HTTP types
│   │   └── models/             # SQLAlchemy ORM models: User, Item, Meeting
│   ├── migrations/versions/    # 0001-0002 items, 0003 users + item owner, 0004 meetings
│   └── tests/                  # pytest against a real Postgres (a separate *_test database)
│
└── frontend/                   # the web client (Next.js App Router, React, Tailwind, shadcn/ui)
    ├── Dockerfile              # base / deps / dev / builder / runtime stages
    ├── app/
    │   ├── layout.tsx, globals.css   # root layout; theme tokens (Spry green palette)
    │   ├── page.tsx, signup/, auth/callback/   # sign-in screens
    │   ├── (app)/              # signed-in pages behind AuthGate: home, items
    │   └── (public)/meetings/  # the Spry page: no sign-in needed
    ├── components/
    │   ├── ui/                 # shadcn/ui primitives — generated, not hand-edited
    │   ├── meetings-view.tsx   # the /meetings page: stats + form + list
    │   ├── week-stats.tsx      # this week vs last week: meetings, hours, person-hours
    │   ├── meeting-form.tsx, meeting-list.tsx, panel.tsx
    │   └── ...                 # template components: board, dashboard, header, auth screens
    ├── lib/
    │   ├── api.ts              # the only place that talks HTTP; zod schemas mirror the API
    │   ├── auth.ts             # Cognito sign-in from the browser, token storage, useSession
    │   └── week.ts             # week-over-week arithmetic for the meetings page
    └── tests/                  # vitest + Testing Library
```

Rule: nothing outside `backend/` imports its Python, nothing outside `frontend/` imports its
TypeScript. Inside the backend, **routes** know HTTP, **services** know the domain and the
queries, **models** know the tables — so logic can be tested without HTTP, and the HTTP layer can
change without touching queries.

---

## 4. API contract — meetings

JSON only. Datetimes are **ISO 8601 with a UTC offset**; the API answers in UTC with a `Z`
suffix, e.g. `"2026-10-01T09:00:00Z"`. A datetime without an offset in a request is rejected with
`422`. Errors use FastAPI's default shape `{"detail": ...}`. No `Authorization` header needed.

### `GET /api/meetings`

`200` — a JSON **array** of `Meeting`, ordered by `starts_at` ascending, then `id`. Empty → `[]`.

### `POST /api/meetings`

Body `MeetingCreate` → `201` `Meeting`. Invalid body → `422`.

```
MeetingCreate
  title           string   required, 1..200 chars after trimming whitespace
  starts_at       string   ISO 8601 datetime with offset
  ends_at         string   ISO 8601 datetime with offset, strictly after starts_at
  attendee_count  integer  1..10000

Meeting = MeetingCreate +
  id              integer  assigned by the database
```

```json
{
  "id": 1,
  "title": "Weekly planning",
  "starts_at": "2026-10-01T09:00:00Z",
  "ends_at": "2026-10-01T10:00:00Z",
  "attendee_count": 6
}
```

If the database is unreachable during a request, any endpoint answers `503`
`{"detail": "database unavailable"}` instead of a stack trace; `pool_pre_ping` reconnects the pool
by itself once the database is back.

The rest of the API (`/health`, `/api/v1/health/ready`, `/api/v1/me`, `/api/v1/items`) is
specified in README §5.

---

## 5. Database — `meetings`

Created by migration `0004`:

| column           | type           | constraints                             |
|------------------|----------------|-----------------------------------------|
| `id`             | `integer`      | primary key, identity                   |
| `title`          | `varchar(200)` | not null                                |
| `starts_at`      | `timestamptz`  | not null, indexed                       |
| `ends_at`        | `timestamptz`  | not null, `CHECK (ends_at > starts_at)` |
| `attendee_count` | `integer`      | not null, `CHECK (attendee_count >= 1)` |

Schema changes land only through an Alembic revision, never `Base.metadata.create_all()` (tests
only). A running product's database has rows in it; a migration is a versioned, reviewable,
reversible change to that schema — `create_all` only creates what is missing and cannot alter or
undo anything. Migrations run **at container start** (`entrypoint.sh`, or the override's
command in development) and, on Lambda, through the deploy script's `{"action": "migrate"}`
invoke — never at image build time, when no database exists.

---

## 6. Docker Compose

Three services; startup order `db` → `backend` → `frontend`, each waiting for **readiness**.

| service    | image / build        | port (host:container) | depends on                            | ready when                          |
|------------|----------------------|-----------------------|---------------------------------------|-------------------------------------|
| `db`       | `postgres:17-alpine` | `5432:5432`           | —                                     | `pg_isready` succeeds               |
| `backend`  | `./backend`          | `8000:8000`           | `db: condition: service_healthy`      | `curl -f http://localhost:8000/health` |
| `frontend` | `./frontend`         | `3000:3000`           | `backend: condition: service_healthy` | last in the chain                   |

- `depends_on` alone only orders start; `condition: service_healthy` waits for the healthcheck.
- The browser calls the API at `http://localhost:8000` (`NEXT_PUBLIC_API_URL`); the backend
  allows that origin through CORS (`CORS_ORIGINS=http://localhost:3000`).
- **Development only** (`docker-compose.override.yml` and friends): the bind mounts, `uvicorn
  --reload`, `next dev`, the published `5432`, the default `peach/peach` database password.

---

## 7. Pinned versions

| what                  | version                         |
|-----------------------|---------------------------------|
| Postgres image        | `postgres:17-alpine`            |
| Python image          | `python:3.14-slim`              |
| uv (copied in)        | `ghcr.io/astral-sh/uv:0.12.21`  |
| Node image            | `node:22-alpine`                |
| pnpm                  | `10.34.5`                       |
| Next.js / React       | `16.3.4` / `19.2.8`             |

Everything else: exact versions in `backend/uv.lock` and `frontend/pnpm-lock.yaml`.

---

## 8. Quality gates

- Backend: `ruff check`, `ruff format --check`, `pytest`, `alembic check` (models = migrations).
- Frontend: `eslint`, `prettier --check`, `next typegen` + `tsc --noEmit`, `vitest`.
- CI (`.github/workflows/lint.yml`) runs the linters and type check on every push.
