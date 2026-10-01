# Spry — PROJECT.md

The structure of the repository: folders, what lives in each one, and the contracts between the
parts. No implementation code. It is the specification the code was generated from: if the code
and this file disagree, the code is the bug.

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
  HTTP contract in §4.

---

## 2. Scope of the first slice

- The backend exposes `GET /api/meetings` (list), `POST /api/meetings` (create one) and
  `DELETE /api/meetings/{id}` (delete one).
- A meeting has: `id`, `title`, `starts_at`, `ends_at`, `attendee_count`.
- The frontend has one page that lists meetings and has a form that adds a new one, plus this
  week's numbers compared with last week. Each meeting can be deleted after a confirmation.
- `docker compose up --build` is the only command a new developer runs (after Docker Desktop).

Deliberately **not** in this slice: sign-in, editing meetings, pagination, caches, queues,
reverse proxies, a second database. The course template's extras (Cognito sign-in, a Lambda
deploy path, a task board) were removed: nothing in this scope used them.

---

## 3. Repository layout

```
Peach/
├── PROJECT.md                  # this specification
├── README.md                   # how to run, test and deploy it
├── .env.example                # every variable Compose and the scripts read
├── docker-compose.yml          # db, backend, frontend
├── docker-compose.override.yml # development only: bind mounts + hot reload (auto-loaded)
├── Makefile                    # the contract: compose shortcuts + deploy-backend / deploy-frontend
├── .github/workflows/
│   ├── lint.yml                # every push to main and every PR: ruff, eslint, prettier, tsc, vitest
│   └── deploy-backend.yml      # every push to main: lint + tests, then make deploy-backend
├── infra/                      # CloudFormation
│   ├── backend-ecs.yaml        # ALB + ECS Fargate + RDS PostgreSQL (+ HTTPS listener, DNS)
│   ├── frontend.yaml           # private S3 bucket + CloudFront (+ certificate, DNS)
│   └── github-oidc.yaml        # the role GitHub Actions assumes through OIDC
├── scripts/                    # what the Makefile runs
│   ├── deploy-backend-ecs.sh   # build -> ECR (tag = commit SHA) -> CloudFormation -> ECS
│   ├── domain-backend.sh       # ACM certificate + :443 listener for api.<domain>
│   ├── destroy-backend-ecs.sh  # tear the backend down, database included
│   ├── deploy-frontend.sh      # vite build -> S3 sync -> CloudFront invalidation
│   ├── domain-frontend.sh      # us-east-1 certificate + alias for app.<domain>
│   ├── destroy-frontend.sh     # empty the bucket, delete the distribution
│   └── github-role.sh          # create the OIDC role and set the repository variables
│
├── backend/                    # the HTTP API (FastAPI)
│   ├── Dockerfile              # builder / dev / runtime stages
│   ├── pyproject.toml, uv.lock # dependencies + ruff + pytest config; exact versions committed
│   ├── alembic.ini
│   ├── scripts/entrypoint.sh   # container start: alembic upgrade head, then uvicorn
│   ├── app/
│   │   ├── main.py             # app factory: CORS, /health, router, database-error handler
│   │   ├── config.py           # Settings from environment variables — nothing else reads env
│   │   ├── db.py               # async engine, session factory, get_session dependency
│   │   ├── api/router.py       # everything under /api
│   │   ├── api/routes/         # HTTP layer: meetings, health (readiness)
│   │   ├── schemas/            # Pydantic models = the wire contract of §4
│   │   ├── services/           # business logic and queries, no HTTP types
│   │   └── models/             # SQLAlchemy ORM model: Meeting
│   ├── migrations/versions/    # 0001-0003 the template's tables, 0004 meetings, 0005 drops the template's
│   └── tests/                  # pytest against a real Postgres (a separate *_test database)
│
└── frontend/                   # the single-page web client (React + Vite)
    ├── Dockerfile              # base / deps / dev / builder / runtime stages
    ├── index.html              # Vite entry HTML
    ├── vite.config.ts          # React + Tailwind plugins, `@/` alias, vitest settings
    ├── components.json         # shadcn/ui CLI config
    ├── eslint.config.js        # ESLint (TypeScript + React hooks rules)
    ├── src/
    │   ├── main.tsx, App.tsx   # mount + the one page: header, meetings view, toasts
    │   ├── index.css           # Tailwind + theme tokens (Spry green palette)
    │   ├── components/
    │   │   ├── ui/             # shadcn/ui primitives (button, input, label, skeleton, dialog, toast)
    │   │   ├── meetings-view.tsx  # the page: stats + form + list + delete dialog
    │   │   ├── week-stats.tsx     # this week vs last week: meetings and hours
    │   │   ├── meeting-form.tsx, meeting-list.tsx, panel.tsx, page-header.tsx
    │   │   └── site-header.tsx, providers.tsx
    │   └── lib/
    │       ├── api.ts          # the only place that talks HTTP; zod schemas mirror §4
    │       ├── week.ts         # week-over-week arithmetic
    │       └── utils.ts        # cn() for class names
    └── tests/                  # vitest
```

Rule: nothing outside `backend/` imports its Python, nothing outside `frontend/` imports its
TypeScript. Inside the backend, **routes** know HTTP, **services** know the domain and the
queries, **models** know the tables — so logic can be tested without HTTP, and the HTTP layer can
change without touching queries.

---

## 4. API contract

JSON only. Datetimes are **ISO 8601 with a UTC offset**; the API answers in UTC with a `Z`
suffix, e.g. `"2026-10-01T09:00:00Z"`. A datetime without an offset in a request is rejected with
`422`. Errors use FastAPI's default shape `{"detail": ...}`. No sign-in, no `Authorization` header.

### `GET /health`

`200` `{"status": "ok"}` — liveness only, touches no dependency. The Compose healthcheck and the
load balancer's health check call it.

### `GET /api/health/ready`

`200` `{"status": "ok", "database": "ok"}` after a `SELECT 1`; `503` when the database does not
answer.

### `GET /api/meetings`

`200` — a JSON **array** of `Meeting`, ordered by `starts_at` ascending, then `id`. Empty → `[]`.

### `POST /api/meetings`

Body `MeetingCreate` → `201` `Meeting`. Invalid body → `422`. The row is committed **before** the
response is sent, so a GET right after the 201 already lists it.

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

### `DELETE /api/meetings/{id}`

`204` with no body. No such meeting (or already deleted) → `404` `{"detail": "Meeting not found"}`.
Deletion is permanent.

If the database is unreachable during a request, any endpoint answers `503`
`{"detail": "database unavailable"}` instead of a stack trace; `pool_pre_ping` reconnects the pool
by itself once the database is back.

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

Revisions `0001`–`0003` are the course template's tables; `0005` drops them. They stay in the
history because databases that already ran them need `0005` to move on.

Schema changes land only through an Alembic revision, never `Base.metadata.create_all()` (tests
only). A running product's database has rows in it; a migration is a versioned, reviewable,
reversible change to that schema — `create_all` only creates what is missing and cannot alter or
undo anything. Migrations run **at container start** (`entrypoint.sh`, or the override's command
in development) — on ECS every new task runs `alembic upgrade head` before uvicorn starts. Never at
image build time, when no database exists.

---

## 6. Docker Compose

Three services; startup order `db` → `backend` → `frontend`, each waiting for **readiness**.

| service    | image / build        | port (host:container) | depends on                            | ready when                             |
|------------|----------------------|-----------------------|---------------------------------------|----------------------------------------|
| `db`       | `postgres:17-alpine` | `5432:5432`           | —                                     | `pg_isready` succeeds                  |
| `backend`  | `./backend`          | `8000:8000`           | `db: condition: service_healthy`      | `curl -f http://localhost:8000/health` |
| `frontend` | `./frontend`         | `5173:5173`           | `backend: condition: service_healthy` | last in the chain                      |

- `depends_on` alone only orders start; `condition: service_healthy` waits for the healthcheck.
- The browser calls the API at `http://localhost:8000` (`VITE_API_URL`); the backend allows the
  frontend's origin through CORS (`CORS_ORIGINS=http://localhost:5173`).
- **Development only** (`docker-compose.override.yml`): the bind mounts, `uvicorn --reload`, the
  Vite dev server, the published `5432`, the default `peach/peach` database password.

---

## 7. Pinned versions

| what                  | version                         |
|-----------------------|---------------------------------|
| Postgres image        | `postgres:17-alpine`            |
| Python image          | `python:3.14-slim`              |
| uv (copied in)        | `ghcr.io/astral-sh/uv:0.12.21`  |
| Node image            | `node:22-alpine`                |
| pnpm                  | `10.34.5`                       |
| React / Vite          | `19.2.8` / `8.2.2`              |

Everything else: exact versions in `backend/uv.lock` and `frontend/pnpm-lock.yaml`.

---

## 8. Quality gates

- Backend: `ruff check`, `ruff format --check`, `alembic check` (models = migrations), `pytest`.
- Frontend: `eslint`, `prettier --check`, `tsc --noEmit`, `vitest`.
- CI (`.github/workflows/lint.yml`) runs both sides' gates on every push to `main` and every PR.
- CD (`.github/workflows/deploy-backend.yml`): every push to `main` runs the backend gates, then
  `make deploy-backend` — image to ECR tagged with the commit SHA, ECS service rolled to it.

---

## 9. Deployment (AWS)

| part     | where                                                              | address                |
|----------|--------------------------------------------------------------------|------------------------|
| frontend | Vite bundle in a private S3 bucket, behind CloudFront (HTTPS)      | `https://app.<domain>` |
| backend  | ECS service on Fargate behind an Application Load Balancer (HTTPS) | `https://api.<domain>` |
| database | RDS PostgreSQL, reachable from the backend tasks only              | —                      |

The Makefile is the deploy contract: `make deploy-frontend` and `make deploy-backend` are exactly
what is run by hand and by CI. GitHub Actions authenticates with OIDC (`make github-role`): a role
trusted only for this repository's `main` branch, no access key stored anywhere.
