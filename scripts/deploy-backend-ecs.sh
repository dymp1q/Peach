#!/usr/bin/env bash
# Build the backend image, push it to ECR tagged with the commit SHA, and roll
# the ECS service in infra/backend-ecs.yaml to it: an Application Load
# Balancer in front, Fargate tasks behind it, PostgreSQL on RDS.
#
# The same command runs locally (make deploy-backend) and in CI - there is no
# separate recipe for the pipeline, so a failed deploy can be debugged here.
#
# Safe to re-run: the CloudFormation stack is the source of truth. Every run
# after the first is an in-place update; ECS starts a task on the new image,
# waits until the load balancer's health check passes, then stops the old one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/backend-ecs.yaml"
ENV_FILE="${ROOT}/.env"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# --- configuration ----------------------------------------------------------

if [[ -f "${ENV_FILE}" ]]; then
  # Variables already exported win over .env: `AWS_REGION=eu-central-1 make x`
  # must not be quietly reset to the region .env names.
  preset="$(export -p)"
  set -a
  # shellcheck disable=SC1091
  source "${ENV_FILE}"
  set +a
  eval "${preset}"
fi

# A blank AWS_PROFILE is read as a profile literally named "", and blank keys
# short-circuit the credential chain. Treat empty as absent.
for var in AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [[ -n "${!var:-}" ]] || unset "${var}"
done

PROJECT_NAME="${PROJECT_NAME:-peach}"
STACK_NAME="${ECS_STACK_NAME:-${PROJECT_NAME}-backend-ecs}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
ECR_REPOSITORY="${ECR_REPOSITORY:-${PROJECT_NAME}-backend}"
# Fargate runs the task on Graviton (ARM64); the image must match.
PLATFORM="linux/arm64"

# Rewrite one KEY=VALUE in .env, leaving every other line - credentials very
# much included - exactly as it was.
env_set() {
  KEY="$1" VALUE="$2" ENV_FILE="${ENV_FILE}" python3 - <<'PY'
import os, re

key, value, path = os.environ["KEY"], os.environ["VALUE"], os.environ["ENV_FILE"]
lines = open(path).read().splitlines() if os.path.exists(path) else []
pattern = re.compile(rf"^{re.escape(key)}=")

for i, line in enumerate(lines):
    if pattern.match(line):
        lines[i] = f"{key}={value}"
        break
else:
    lines.append(f"{key}={value}")

open(path, "w").write("\n".join(lines) + "\n")
PY
  log "wrote ${1}=${2} to .env"
}

stack_output() {
  aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text 2>/dev/null || true
}

# --- preflight --------------------------------------------------------------

for tool in aws docker python3 curl git; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} is required but not installed"
done
docker info >/dev/null 2>&1 || die "docker daemon is not running"

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "no usable AWS credentials - set AWS_PROFILE or the AWS_* keys in .env"
log "account ${ACCOUNT_ID} in ${AWS_REGION} as $(aws sts get-caller-identity --query Arn --output text)"

# --- network ----------------------------------------------------------------

if [[ -z "${AWS_VPC_ID:-}" ]]; then
  AWS_VPC_ID="$(aws ec2 describe-vpcs --filters Name=is-default,Values=true \
    --query 'Vpcs[0].VpcId' --output text)"
  [[ "${AWS_VPC_ID}" != "None" && -n "${AWS_VPC_ID}" ]] \
    || die "no default VPC in ${AWS_REGION} - set AWS_VPC_ID and AWS_SUBNET_IDS"
  log "using the default VPC ${AWS_VPC_ID}"
fi

if [[ -z "${AWS_SUBNET_IDS:-}" ]]; then
  # The default subnets are public: tasks get a public IP and reach ECR and
  # Secrets Manager directly, so no NAT gateway is needed.
  AWS_SUBNET_IDS="$(aws ec2 describe-subnets \
    --filters "Name=vpc-id,Values=${AWS_VPC_ID}" Name=default-for-az,Values=true \
    --query 'Subnets[].SubnetId' --output text | tr '\t' ',')"
  [[ -n "${AWS_SUBNET_IDS}" ]] || die "no default subnets in ${AWS_VPC_ID}"
  log "using subnets ${AWS_SUBNET_IDS}"
fi
[[ "${AWS_SUBNET_IDS}" == *,* ]] \
  || die "the load balancer and the database need subnets in at least two availability zones"

# --- image: build, tag with the commit, push --------------------------------

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
if ! aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" >/dev/null 2>&1; then
  log "creating ECR repository ${ECR_REPOSITORY}"
  aws ecr create-repository \
    --repository-name "${ECR_REPOSITORY}" \
    --image-scanning-configuration scanOnPush=true \
    --image-tag-mutability MUTABLE \
    --tags "Key=PROJECT_NAME,Value=${PROJECT_NAME}" >/dev/null
  aws ecr put-lifecycle-policy \
    --repository-name "${ECR_REPOSITORY}" \
    --lifecycle-policy-text '{"rules":[{"rulePriority":1,"description":"keep the last 10 images","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}' \
    >/dev/null
fi

# The tag is the commit, never "latest": the running version is always
# traceable, and a rollback is "deploy the previous SHA".
if [[ -z "${IMAGE_TAG:-}" || "${IMAGE_TAG}" == "latest" ]]; then
  IMAGE_TAG="$(git -C "${ROOT}" rev-parse HEAD)"
  # Uncommitted backend changes get a unique suffix, so they are never
  # mistaken for the clean commit - and CloudFormation sees a new image.
  git -C "${ROOT}" diff --quiet HEAD -- backend \
    || IMAGE_TAG="${IMAGE_TAG}-dirty-$(date -u +%Y%m%d%H%M%S)"
fi
IMAGE_URI="${REGISTRY}/${ECR_REPOSITORY}:${IMAGE_TAG}"

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}" >/dev/null

if aws ecr describe-images --repository-name "${ECR_REPOSITORY}" \
  --image-ids "imageTag=${IMAGE_TAG}" >/dev/null 2>&1; then
  log "${IMAGE_TAG} is already in ECR - not rebuilding"
else
  log "building ${IMAGE_URI} for ${PLATFORM}"
  # --target runtime: the production stage, no dev dependencies.
  docker buildx build \
    --platform "${PLATFORM}" \
    --target runtime \
    --provenance=false \
    --sbom=false \
    --tag "${IMAGE_URI}" \
    --push \
    "${ROOT}/backend"
fi

# --- database password ------------------------------------------------------

# The stack composes DATABASE_URL from this password, so it must stay the same
# across deploys. Read it back from the stack's secret; mint one only on the
# very first run.
DB_PASSWORD=""
SECRET_ARN="$(stack_output DatabaseUrlSecretArn)"
if [[ -n "${SECRET_ARN}" && "${SECRET_ARN}" != "None" ]]; then
  DB_PASSWORD="$(aws secretsmanager get-secret-value --secret-id "${SECRET_ARN}" \
    --query SecretString --output text 2>/dev/null \
    | python3 -c 'import sys,urllib.parse; print(urllib.parse.urlsplit(sys.stdin.read().strip()).password or "")')"
fi
if [[ -z "${DB_PASSWORD}" ]]; then
  log "generating the database password"
  # No /, ", @ or space: RDS rejects those, and it keeps the URL parseable.
  DB_PASSWORD="$(python3 -c '
import secrets, string
alphabet = string.ascii_letters + string.digits + "-_.~"
print("".join(secrets.choice(alphabet) for _ in range(40)))')"
fi

# --- deploy -----------------------------------------------------------------

# Parameters go through a 0600 file rather than argv, so the password never
# shows up in `ps`.
PARAMS_FILE="$(mktemp)"
chmod 600 "${PARAMS_FILE}"
trap 'rm -f "${PARAMS_FILE}"' EXIT

PROJECT_NAME="${PROJECT_NAME}" \
VPC_ID="${AWS_VPC_ID}" \
SUBNETS="${AWS_SUBNET_IDS}" \
IMAGE_URI="${IMAGE_URI}" \
CPU="${ECS_CPU:-}" \
MEMORY="${ECS_MEMORY:-}" \
DESIRED_COUNT="${ECS_DESIRED_COUNT:-}" \
DB_NAME="${DB_NAME:-${POSTGRES_DB:-peach}}" \
DB_USERNAME="${DB_USERNAME:-${POSTGRES_USER:-peach}}" \
DB_PASSWORD="${DB_PASSWORD}" \
DB_INSTANCE_CLASS="${DB_INSTANCE_CLASS:-}" \
APP_ENV="${APP_ENV_AWS:-production}" \
LOG_LEVEL="${LOG_LEVEL:-info}" \
CORS_ORIGINS="${API_CORS_ORIGINS:-}" \
COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
COGNITO_CLIENT_ID="${COGNITO_CLIENT_ID:-}" \
python3 - "${PARAMS_FILE}" <<'PY'
import json, os, sys

params = {
    "ProjectName": os.environ["PROJECT_NAME"],
    "VpcId": os.environ["VPC_ID"],
    "SubnetIds": os.environ["SUBNETS"],
    "ImageUri": os.environ["IMAGE_URI"],
    "Cpu": os.environ["CPU"],
    "Memory": os.environ["MEMORY"],
    "DesiredCount": os.environ["DESIRED_COUNT"],
    "DbName": os.environ["DB_NAME"],
    "DbUsername": os.environ["DB_USERNAME"],
    "DbPassword": os.environ["DB_PASSWORD"],
    "DbInstanceClass": os.environ["DB_INSTANCE_CLASS"],
    "AppEnv": os.environ["APP_ENV"],
    "LogLevel": os.environ["LOG_LEVEL"],
    "CorsOrigins": os.environ["CORS_ORIGINS"],
    "CognitoUserPoolId": os.environ["COGNITO_USER_POOL_ID"],
    "CognitoClientId": os.environ["COGNITO_CLIENT_ID"],
}
# An empty value means "leave this alone": for an existing stack CloudFormation
# keeps the current value of any parameter the deploy does not mention - which
# is how the domain settings from make domain-backend survive every deploy,
# and how CI (which has no .env) does not reset CORS.
with open(sys.argv[1], "w") as fh:
    json.dump(
        [{"ParameterKey": k, "ParameterValue": v} for k, v in params.items() if v != ""],
        fh,
    )
PY

if ! aws cloudformation describe-stacks --stack-name "${STACK_NAME}" >/dev/null 2>&1; then
  log "first deploy - creating ${STACK_NAME} (RDS takes around 10 minutes)"
else
  log "updating ${STACK_NAME} to ${IMAGE_TAG}"
fi

# CloudFormation waits for the ECS service to reach a steady state, i.e. until
# the new task passes the load balancer's health check.
if ! aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --parameter-overrides "file://${PARAMS_FILE}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset \
  --tags "PROJECT_NAME=${PROJECT_NAME}"; then
  warn "deploy failed - most recent failure reasons:"
  aws cloudformation describe-stack-events --stack-name "${STACK_NAME}" \
    --max-items 40 \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
    --output table >&2 || true
  warn "container logs: make logs-backend"
  exit 1
fi

# --- report -----------------------------------------------------------------

API_URL="$(stack_output ApiUrl)"
API_URL="${API_URL%/}"

# deploy-frontend.sh compiles the bundle against this. Until make
# domain-backend has run it is plain http://, which the frontend refuses.
env_set BACKEND_URL "${API_URL}"

echo
echo "  image      ${IMAGE_URI}"
echo "  api        ${API_URL}"
echo "  health     ${API_URL}/health"
echo "  docs       ${API_URL}/docs"
echo "  alb        $(stack_output LoadBalancerDnsName)"
echo "  database   $(stack_output DatabaseEndpoint)"
echo "  logs       make logs-backend"
echo

if curl -fsS --max-time 30 "${API_URL}/health" >/dev/null 2>&1; then
  log "GET /health answered"
else
  warn "GET /health did not answer yet - check: make logs-backend"
fi

if [[ "${API_URL}" == http://* ]]; then
  echo "Next: make domain-backend DOMAIN=api.example.com - HTTPS on your own domain."
fi
