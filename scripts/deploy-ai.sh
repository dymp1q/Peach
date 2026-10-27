#!/usr/bin/env bash
# Create or update the agenda parser stack (infra/ai.yml): the parser function,
# its public URL, its role, and the monthly budget alarm.
#
# Everything it needs is read from the stacks already running, not typed in:
# the image from the backend, the user pool and web client from the auth
# stack, the site's origin from DOMAIN_NAME. Deploy the backend first, so its
# image has app/ai in it; then make deploy-frontend builds against the URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/ai.yml"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

if [[ -f "${ROOT}/.env" ]]; then
  # Variables already exported win over .env.
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
STACK_NAME="${AI_STACK_NAME:-${PROJECT_NAME}-ai}"
BACKEND_STACK="${BACKEND_STACK_NAME:-${PROJECT_NAME}-backend-ecs}"
AUTH_STACK="${AUTH_STACK_NAME:-${PROJECT_NAME}-auth}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
PARSER_MODEL="${PARSER_MODEL:-anthropic.claude-opus-5-5}"

# --- preflight --------------------------------------------------------------

command -v aws >/dev/null 2>&1 || die "aws is required but not installed"
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "no usable AWS credentials - set AWS_PROFILE or the AWS_* keys in .env"

BUDGET_EMAIL="${BUDGET_EMAIL:-${REPORT_RECIPIENTS%%,*}}"
[[ -n "${BUDGET_EMAIL}" ]] || die "set BUDGET_EMAIL in .env (where the budget alarm goes)"

# The browser calls the parser from the site; localhost too, for development.
ORIGINS="http://localhost:5173"
[[ -n "${DOMAIN_NAME:-}" ]] && ORIGINS="https://${DOMAIN_NAME},${ORIGINS}"

# --- what is already running ------------------------------------------------

stack_query() {
  aws cloudformation describe-stacks --stack-name "$1" --query "$2" --output text 2>/dev/null || true
}

IMAGE_URI="$(stack_query "${BACKEND_STACK}" "Stacks[0].Parameters[?ParameterKey=='ImageUri'].ParameterValue")"
[[ -n "${IMAGE_URI}" && "${IMAGE_URI}" != "None" ]] \
  || die "no ${BACKEND_STACK} stack - run make deploy-backend first"

ISSUER="$(stack_query "${AUTH_STACK}" "Stacks[0].Outputs[?OutputKey=='Authority'].OutputValue")"
CLIENT_ID="$(stack_query "${AUTH_STACK}" "Stacks[0].Outputs[?OutputKey=='ClientId'].OutputValue")"
[[ -n "${CLIENT_ID}" && "${CLIENT_ID}" != "None" ]] \
  || die "no ${AUTH_STACK} stack - the parser answers signed-in users only; run make deploy-auth"

log "image          ${IMAGE_URI}"
log "model          ${PARSER_MODEL}"
log "sign-in        ${ISSUER}"
log "origins        ${ORIGINS}"
log "budget alarm   \$5/month -> ${BUDGET_EMAIL}"

# --- deploy -----------------------------------------------------------------

log "deploying ${STACK_NAME} in ${AWS_REGION}"

if ! aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "ImageUri=${IMAGE_URI}" \
    "ParserModel=${PARSER_MODEL}" \
    "CognitoIssuer=${ISSUER}" \
    "CognitoClientId=${CLIENT_ID}" \
    "AllowedOrigins=${ORIGINS}" \
    "BudgetEmail=${BUDGET_EMAIL}" \
  --no-fail-on-empty-changeset \
  --tags "PROJECT_NAME=${PROJECT_NAME}"; then
  warn "deploy failed - most recent failure reasons:"
  aws cloudformation describe-stack-events --stack-name "${STACK_NAME}" \
    --max-items 40 \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
    --output table >&2 || true
  exit 1
fi

PARSER_URL="$(stack_query "${STACK_NAME}" "Stacks[0].Outputs[?OutputKey=='ParserUrl'].OutputValue")"

echo
echo "  parser   ${PARSER_URL}"
echo "  logs     make logs-ai"
echo
echo "Then: make deploy-frontend (it reads the parser's URL from this stack)."
echo
