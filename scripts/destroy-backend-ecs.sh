#!/usr/bin/env bash
# Tear the ECS backend down: the load balancer, the ECS service and cluster,
# the RDS database with everything in it, and the secret. These bill by the
# hour whether anyone visits or not - this is what stops that.
#
# The ECR repository is left alone (it holds a few cents of images, and the
# Lambda deploy shares it); delete it with ECR_TOO=1.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

if [[ -f "${ROOT}/.env" ]]; then
  # Variables already exported win over .env: `AWS_REGION=eu-central-1 make x`
  # must not be quietly reset to the region .env names.
  preset="$(export -p)"
  set -a
  # shellcheck disable=SC1091
  source "${ROOT}/.env"
  set +a
  eval "${preset}"
fi

for var in AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [[ -n "${!var:-}" ]] || unset "${var}"
done

PROJECT_NAME="${PROJECT_NAME:-peach}"
STACK_NAME="${ECS_STACK_NAME:-${PROJECT_NAME}-backend-ecs}"
ECR_REPOSITORY="${ECR_REPOSITORY:-${PROJECT_NAME}-backend}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

command -v aws >/dev/null 2>&1 || die "aws cli is required"
aws cloudformation describe-stacks --stack-name "${STACK_NAME}" >/dev/null 2>&1 \
  || die "stack ${STACK_NAME} does not exist in ${AWS_REGION}"

if [[ "${FORCE:-0}" != "1" ]]; then
  echo "This deletes stack ${STACK_NAME} in ${AWS_REGION}: the load balancer,"
  echo "the ECS service, and the ${PROJECT_NAME}-ecs-db database with all its data."
  read -r -p "Type the stack name to confirm: " reply
  [[ "${reply}" == "${STACK_NAME}" ]] || die "aborted"
fi

log "deleting ${STACK_NAME} (RDS takes several minutes)"
aws cloudformation delete-stack --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}"

# Secrets Manager schedules deletions instead of doing them, and the name stays
# taken for the whole recovery window - which would block the next deploy.
SECRET_NAME="${PROJECT_NAME}/backend-ecs/database-url"
if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" >/dev/null 2>&1; then
  log "force-deleting the ${SECRET_NAME} secret so the name is free again"
  aws secretsmanager delete-secret --secret-id "${SECRET_NAME}" \
    --force-delete-without-recovery >/dev/null
fi

if [[ "${ECR_TOO:-0}" == "1" ]] \
  && aws ecr describe-repositories --repository-names "${ECR_REPOSITORY}" >/dev/null 2>&1; then
  log "deleting the ECR repository ${ECR_REPOSITORY} and its images"
  aws ecr delete-repository --repository-name "${ECR_REPOSITORY}" --force >/dev/null
fi

log "done. The ACM certificate and the DNS record (if DNS is outside Route 53) stay."
