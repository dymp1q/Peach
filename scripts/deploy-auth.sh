#!/usr/bin/env bash
# Create or update the sign-in stack (infra/auth.yaml): the Cognito user pool,
# Google as an identity provider, the managed login domain and the web client.
#
# The Google client id and secret come from .env (gitignored); the secret goes
# to CloudFormation as a NoEcho parameter and nowhere else. make deploy-frontend
# reads this stack's outputs, so deploy this first, then the frontend.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/auth.yaml"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m==>\033[0m %s\n' "$*" >&2; }
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

# A blank AWS_PROFILE is read as a profile literally named "", and blank keys
# short-circuit the credential chain. Treat empty as absent.
for var in AWS_PROFILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN; do
  [[ -n "${!var:-}" ]] || unset "${var}"
done

PROJECT_NAME="${PROJECT_NAME:-peach}"
STACK_NAME="${AUTH_STACK_NAME:-${PROJECT_NAME}-auth}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
# Must match the prefix in the Google client's origin and redirect URI.
DOMAIN_PREFIX="${COGNITO_DOMAIN_PREFIX:-${PROJECT_NAME}}"
LOCAL_URL="http://localhost:${FRONTEND_PORT:-5173}"

# --- preflight --------------------------------------------------------------

command -v aws >/dev/null 2>&1 || die "aws is required but not installed"
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "no usable AWS credentials - set AWS_PROFILE or the AWS_* keys in .env"

[[ -n "${GOOGLE_CLIENT_ID:-}" && -n "${GOOGLE_CLIENT_SECRET:-}" ]] \
  || die "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env"

# --- where may Cognito send the browser back? -------------------------------

# The deployed site (custom domain if it has one) plus the Vite dev server.
# Exact matches, trailing slash included: /auth/callback/ is what the app sends.
if [[ -n "${DOMAIN_NAME:-}" ]]; then
  SITE_URL="https://${DOMAIN_NAME}"
else
  SITE_URL="$(aws cloudformation describe-stacks \
    --stack-name "${FRONTEND_STACK_NAME:-${PROJECT_NAME}-frontend}" \
    --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" \
    --output text 2>/dev/null || true)"
fi
[[ -n "${SITE_URL}" && "${SITE_URL}" != "None" ]] \
  || die "no site URL - set DOMAIN_NAME in .env or run make deploy-frontend first"

CALLBACKS="${SITE_URL}/auth/callback/,${LOCAL_URL}/auth/callback/"
LOGOUTS="${SITE_URL}/,${LOCAL_URL}/"

# --- deploy -----------------------------------------------------------------

log "deploying ${STACK_NAME} in ${AWS_REGION} (domain prefix ${DOMAIN_PREFIX})"

if ! aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "DomainPrefix=${DOMAIN_PREFIX}" \
    "CallbackUrls=${CALLBACKS}" \
    "LogoutUrls=${LOGOUTS}" \
    "GoogleClientId=${GOOGLE_CLIENT_ID}" \
    "GoogleClientSecret=${GOOGLE_CLIENT_SECRET}" \
  --no-fail-on-empty-changeset \
  --tags "PROJECT_NAME=${PROJECT_NAME}"; then
  warn "deploy failed - most recent failure reasons:"
  aws cloudformation describe-stack-events --stack-name "${STACK_NAME}" \
    --max-items 40 \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
    --output table >&2 || true
  exit 1
fi

outputs() {
  aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# --- report -----------------------------------------------------------------

echo
echo "  user pool        $(outputs UserPoolId)"
echo "  client id        $(outputs ClientId)"
echo "  managed login    $(outputs CognitoDomain)"
echo "  callbacks        ${CALLBACKS}"
echo
echo "The Google OAuth client must allow this redirect URI:"
echo
echo "  $(outputs GoogleRedirectUri)"
echo
echo "Next: make deploy-frontend - it reads these outputs and compiles them in."
echo
