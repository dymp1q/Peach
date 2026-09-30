COMPOSE := docker compose

.PHONY: help up down build logs ps migrate revision test test-backend test-frontend lint fmt clean shell-backend shell-db deploy-cognito destroy-cognito deploy-backend destroy-backend logs-backend migrate-backend domain-backend deploy-backend-lambda destroy-backend-lambda logs-backend-lambda migrate-backend-lambda cert domain deploy-frontend destroy-frontend github-role

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

deploy-cognito: ## Create/update the Cognito user pool; writes COGNITO_* to .env and prints them
	./scripts/deploy-cognito.sh

destroy-cognito: ## Delete the Cognito stack, every account in the pool included
	./scripts/destroy-cognito.sh

# --- backend on ECS (lab 2): ALB -> Fargate -> RDS ---

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

# --- backend on Lambda (the course template's original path) ---

deploy-backend-lambda: ## Build + push the image, roll the Lambda (function URL + Aurora), migrate, write BACKEND_URL to .env
	./scripts/deploy-backend.sh

destroy-backend-lambda: ## Delete the Lambda backend stack, Aurora cluster included
	./scripts/destroy-backend.sh

logs-backend-lambda: ## Tail the Lambda backend's CloudWatch logs
	aws logs tail /aws/lambda/$${PROJECT_NAME:-peach}-backend --follow --since 10m

migrate-backend-lambda: ## Re-run migrations on the Lambda backend (deploy-backend-lambda already does)
	aws lambda invoke --function-name $${PROJECT_NAME:-peach}-backend \
		--cli-binary-format raw-in-base64-out --payload '{"action":"migrate"}' /dev/stdout

cert: ## Request + DNS-validate a us-east-1 certificate for the frontend: make cert DOMAIN=app.example.com
	./scripts/domain-frontend.sh cert

domain: ## Assign a custom domain to the frontend: make domain DOMAIN=app.example.com
	./scripts/domain-frontend.sh domain

deploy-frontend: ## Build the static export against BACKEND_URL and ship it to S3 + CloudFront
	./scripts/deploy-frontend.sh

destroy-frontend: ## Delete the frontend stack (bucket + distribution)
	./scripts/destroy-frontend.sh

github-role: ## Create the IAM role GitHub Actions assumes to deploy (OIDC, no keys)
	./scripts/github-role.sh
