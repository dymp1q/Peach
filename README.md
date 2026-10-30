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

## Sign-in (lab 4)

```
browser -> app.<domain>/login/ -> Cognito managed login -> (email + password | Google)
        <- app.<domain>/auth/callback/?code=...  (exchanged with PKCE for Cognito tokens)
```

Google never talks to the site: the site talks only to Cognito, and Cognito talks to Google.
`infra/auth.tf` holds the user pool (Essentials tier, email as the username, self sign-up on),
the public web client (no secret, code flow), Google as an identity provider, the managed login
domain (version 2) and its branding.

1. In Google Cloud, create an OAuth client of type *Web application* whose JavaScript origin is
   `https://<prefix>.auth.<region>.amazoncognito.com` and whose redirect URI is the same plus
   `/oauth2/idpresponse`. Scopes: `openid email profile`. Publish the app (*In production*), or
   only its test users can sign in.
2. Put the prefix and the client id in `infra/terraform.tfvars`, and the secret in the HCP
   Terraform workspace as the sensitive variable `google_client_secret`. It never reaches the
   repository or the bundle (it does reach the state, see [docs/adr/0007](docs/adr/0007-terraform.md)).
3. Merge to main; HCP Terraform applies it (see *Infrastructure as code* below). Then:

```bash
make deploy-frontend    # reads the Terraform outputs into VITE_COGNITO_*
```

The frontend uses `react-oidc-context` on top of `oidc-client-ts`. `/login/` calls
`signinRedirect()` as soon as it loads; the header shows the signed-in email and a Sign out
button, which clears the local session and sends the browser to Cognito's `/logout`.
The pool has `prevent_destroy`: deleting it would delete every user in it.

## Paste an agenda (lab 6)

```
parse:  browser --text + Cognito token--> agenda parser (Lambda URL, no VPC) --> Claude on Bedrock
save:   browser --POST /api/meetings/{id}/agenda--> API (ECS) --> RDS
```

On a meeting's page (`/meetings/{id}/`), a signed-in user pastes an email or notes and presses
**Parse**. The parser returns a suggested agenda that fills the normal form. Every field the model
filled shows a *suggested* badge until the user edits it. **Save** goes through the API like a
hand-typed agenda, and the API stores the suggestion next to it. Why it is built this way:
[docs/adr/0006](docs/adr/0006-llm-agenda-parsing.md). The container diagram is in
[docs/architecture.md](docs/architecture.md).

1. In Bedrock → Model catalog (us-east-1), make sure the Anthropic models are available to the
   account. The first time, Bedrock asks for a short use-case form.
2. From your laptop (needs [uv](https://docs.astral.sh/uv/) and AWS credentials):

```bash
make llm-hello                                   # one call: answer, stop_reason, usage
make parse TEXT="Пн 10:00, синк по прайсингу..." # the parser's JSON and its usage
PARSER_MODEL=anthropic.claude-haiku-5-5 make parse TEXT="..."   # the same, ~40x cheaper
make parse-eval > table.md                       # step 5: the five test inputs, one table
```

3. Deploy. The backend's image must contain `app/ai`, so deploy the backend first:

```bash
make deploy-backend     # or a push to main
# the parser function + URL and the $5/month budget alarm are in infra/ai.tf: merge to main
make deploy-frontend    # reads the parser_url output into VITE_PARSER_URL
make logs-ai            # one JSON line per parse: user, model, tokens, latency, cost
```

## Infrastructure as code (lab 7)

Sign-in (lab 4), the weekly report (lab 5) and the agenda parser (lab 6) are described in
Terraform in `infra/*.tf`; until lab 7 they were three CloudFormation stacks. The backend, the
frontend and the GitHub role are still CloudFormation (`infra/*.yaml`), and `infra/backend.tf`
reads the image, the VPC and the database URL from the backend stack.

```
infra/*.tf --pull request--> HCP Terraform: plan as a check --merge--> apply
                             (workspace ooad-dymp1/spry-dev, AWS role through OIDC, no keys)
code       --push to main--> GitHub Actions --> ECS (the app road, unchanged)
```

- The state lives in HCP Terraform, locked during every run. Nobody applies from a laptop:
  there is no `terraform apply` in the Makefile.
- Runs assume the role `hcp-terraform-ooad-dymp1` through OIDC (`TFC_AWS_PROVIDER_AUTH`,
  `TFC_AWS_RUN_ROLE_ARN` in the workspace). The role and its trust are bootstrapped once with
  a separate local Terraform folder.
- Secrets are workspace variables marked sensitive (`google_client_secret`); non-secret values
  are in `infra/terraform.tfvars`.

```bash
terraform login         # once: an HCP Terraform token in ~/.terraform.d/
make infra-init         # connect infra/ to the workspace
make infra-plan         # what would change; changes nothing
make infra-output       # user pool, client, queue, parser URL - what the scripts read
```

Why Terraform, and what it costs: [docs/adr/0007](docs/adr/0007-terraform.md).
