COMPOSE := docker compose

.PHONY: help up down build logs ps migrate revision test test-backend test-frontend lint fmt clean shell-backend shell-db deploy-backend destroy-backend logs-backend migrate-backend domain-backend cert domain deploy-frontend destroy-frontend github-role deploy-auth destroy-auth report-local deploy-reports report-now destroy-reports logs-reports

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

up: ## Start the whole stack (detached)
	$(COMPOSE) up -d --build

down: ## Stop the stack
	$(COMPOSE) down

clean: ## Stop the stack and wipe the database volume
	$(COMPOSE) down -v

build: ## Rebuild images
	$(COMPOSE) build

logs: ## Tail all logs
	$(COMPOSE) logs -f

ps: ## Show service status
	$(COMPOSE) ps

migrate: ## Apply migrations
	$(COMPOSE) exec backend alembic upgrade head

revision: ## Autogenerate a migration: make revision m="add x"
	$(COMPOSE) exec backend alembic revision --autogenerate -m "$(m)"

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests
	$(COMPOSE) exec backend pytest

test-frontend: ## Run frontend tests
	$(COMPOSE) exec frontend pnpm test

lint: ## Lint both sides
	$(COMPOSE) exec backend ruff check .
	$(COMPOSE) exec frontend pnpm lint

fmt: ## Format both sides
	$(COMPOSE) exec backend ruff format .
	$(COMPOSE) exec frontend pnpm format

shell-backend: ## Shell into the backend container
	$(COMPOSE) exec backend bash

shell-db: ## psql into the database
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-peach} -d $${POSTGRES_DB:-peach}

# --- backend: ALB -> ECS Fargate -> RDS ---

deploy-backend: ## Build the image, push it to ECR tagged with the commit SHA, roll the ECS service
	./scripts/deploy-backend-ecs.sh

domain-backend: ## HTTPS on your domain for the API's load balancer: make domain-backend DOMAIN=api.example.com
	./scripts/domain-backend.sh domain

destroy-backend: ## Delete the ECS backend: load balancer, service, RDS database (ECR_TOO=1 for images)
	./scripts/destroy-backend-ecs.sh

logs-backend: ## Tail the ECS backend's CloudWatch logs
	aws logs tail /ecs/$${PROJECT_NAME:-peach}-backend --follow --since 10m

migrate-backend: ## Re-run migrations: restart the tasks, whose entrypoint runs alembic upgrade head
	aws ecs update-service --cluster $${PROJECT_NAME:-peach} --service $${PROJECT_NAME:-peach}-backend \
		--force-new-deployment --query 'service.deployments[0].status' --output text


cert: ## Request + DNS-validate a us-east-1 certificate for the frontend: make cert DOMAIN=app.example.com
	./scripts/domain-frontend.sh cert

domain: ## Assign a custom domain to the frontend: make domain DOMAIN=app.example.com
	./scripts/domain-frontend.sh domain

deploy-frontend: ## Build the Vite bundle against BACKEND_URL and the auth stack, sync to S3, invalidate CloudFront
	./scripts/deploy-frontend.sh

destroy-frontend: ## Delete the frontend stack (bucket + distribution)
	./scripts/destroy-frontend.sh

# --- sign-in: Cognito user pool + Google (lab 4) ---

deploy-auth: ## Cognito user pool, Google sign-in and managed login; needs GOOGLE_CLIENT_* in .env
	./scripts/deploy-auth.sh

destroy-auth: ## Delete the Cognito stack and every user in it
	./scripts/destroy-auth.sh

# --- weekly report: schedule -> SQS -> builder -> S3 -> mailer -> SES (lab 5) ---

report-local: ## Print one week's report from the Compose database: make report-local WEEK=2026-W40
	$(COMPOSE) exec backend python -m app.reports.weekly $(WEEK)

deploy-reports: ## Bucket, queue + DLQ, builder + mailer, Monday schedule, SES; needs REPORT_RECIPIENTS in .env
	./scripts/deploy-reports.sh

report-now: ## Ask for one week's report now: make report-now WEEK=2026-W39
	./scripts/report-now.sh

destroy-reports: ## Empty the reports bucket and delete the report stack
	./scripts/destroy-reports.sh

logs-reports: ## Tail both report functions' logs
	aws logs tail /aws/lambda/$${PROJECT_NAME:-peach}-report-builder /aws/lambda/$${PROJECT_NAME:-peach}-report-mailer --follow --since 30m

github-role: ## Create the IAM role GitHub Actions assumes to deploy (OIDC, no keys)
	./scripts/github-role.sh
