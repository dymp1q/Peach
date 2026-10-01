# Spry

Meetings for your team, week-over-week at a glance. A monorepo: **FastAPI** backend, **React +
Vite** frontend (Tailwind, shadcn/ui), **PostgreSQL** — started with one command, deployed to AWS
by a push to `main`.

**[PROJECT.md](PROJECT.md) is the specification**: folders, the API contract, the database, the
Compose startup order and pinned versions.

| | |
|---|---|
| Frontend | https://app.spry-maryan.pp.ua |
| Backend | https://api.spry-maryan.pp.ua ([docs](https://api.spry-maryan.pp.ua/docs)) |

---

## Run it locally

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), then:

```bash
cp .env.example .env        # optional: the defaults run as they are
docker compose up --build
```

| URL | What |
|-----|------|
| http://localhost:5173 | Frontend |
| http://localhost:8000/docs | API docs (Swagger) |
| http://localhost:8000/health | Liveness probe |
| `postgresql://peach:peach@localhost:5432/peach` | Database |

The first run builds the images and is slow. The backend applies migrations when its container
starts, so the `meetings` table exists before the API answers.

```bash
make test          # backend (pytest, real Postgres) + frontend (vitest)
make lint          # ruff + eslint
make fmt           # format both sides
make revision m="add x"   # new Alembic migration
make clean         # stop and wipe the database volume
```

---

## Deploy to AWS

```
browser -> CloudFront (HTTPS, app.<domain>) -> private S3 bucket          (frontend)
browser -> ALB :443 (HTTPS, api.<domain>) -> ECS Fargate :8000 -> RDS     (backend)
```

Put your region and project name in `.env` (`AWS_REGION`, `PROJECT_NAME`), log in with
`aws configure` (an IAM user, never the root account), then:

```bash
make deploy-backend                         # image -> ECR (tag = commit SHA) -> ECS behind an ALB, RDS
make domain-backend DOMAIN=api.example.com  # certificate + HTTPS listener for the API
make deploy-frontend                        # vite build -> S3 -> CloudFront invalidation
make domain DOMAIN=app.example.com          # certificate + alias for the site
make github-role                            # the OIDC role CI deploys with
```

With DNS outside Route 53 the domain scripts print the CNAMEs to add by hand: one per
certificate (proves you own the domain) and one per address (`api` → load balancer, `app` →
CloudFront).

**CI/CD.** Every push to `main` runs ruff, `alembic check` and pytest against a Postgres service;
if they pass, the same `make deploy-backend` runs on an ARM runner and rolls ECS to the new image,
tagged with the commit SHA. GitHub authenticates with OIDC: the role trusts only this repository's
`main` branch, and no access key is stored anywhere. `lint.yml` checks both sides on every push
and pull request.

**Costs** (eu-central-1, roughly): ALB ~$0.55/day, one Fargate task ~$0.25/day, RDS
db.t4g.micro ~$0.45/day; S3 + CloudFront are within the free tier. They bill whether anyone visits
or not — tear down when you are done:

```bash
make destroy-backend     # load balancer, ECS, RDS (ECR_TOO=1 also deletes the images)
make destroy-frontend    # bucket + distribution
```
