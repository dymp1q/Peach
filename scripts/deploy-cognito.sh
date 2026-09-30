#!/usr/bin/env bash
# Create or update the Cognito user pool, its hosted domain and the web client
# (infra/cognito.yaml), then write COGNITO_* into .env and print them.
#
# Compose passes them to both services, deploy-backend.sh hands the pool's
# signing keys to the Lambda, and deploy-frontend.sh compiles the ids in.
# Re-run it after the first make deploy-frontend, so the site's URL is allowed
# as an OAuth redirect.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/cognito.yaml"
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
STACK_NAME="${COGNITO_STACK_NAME:-${PROJECT_NAME}-cognito}"
FRONTEND_STACK="${FRONTEND_STACK_NAME:-${PROJECT_NAME}-frontend}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"
LOCAL_URL="http://localhost:${FRONTEND_PORT:-3000}"

# Rewrite one KEY=VALUE in .env, leaving every other line exactly as it was.
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
}

# --- preflight --------------------------------------------------------------

for tool in aws python3; do
  command -v "${tool}" >/dev/null 2>&1 || die "${tool} is required but not installed"
done

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || die "no usable AWS credentials - set AWS_PROFILE or the AWS_* keys in .env"
log "account ${ACCOUNT_ID} in ${AWS_REGION}"

# --- where may sign-in send the browser back? --------------------------------

# Always the local frontend; plus the deployed site, once there is one - both
# its CloudFront name and the custom domain, if make domain assigned one.
SITES=("${LOCAL_URL}")
SITE_URL="$(aws cloudformation describe-stacks --stack-name "${FRONTEND_STACK}" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue" \
  --output text 2>/dev/null || true)"
if [[ -n "${SITE_URL}" && "${SITE_URL}" != "None" ]]; then
  SITES+=("https://${SITE_URL}")
else
  warn "no ${FRONTEND_STACK} stack yet - re-run this after make deploy-frontend"
fi
[[ -n "${DOMAIN_NAME:-}" ]] && SITES+=("https://${DOMAIN_NAME}")

CALLBACKS="$(printf '%s/auth/callback,' "${SITES[@]}")"
LOGOUTS="$(printf '%s/,' "${SITES[@]}")"

# --- deploy -----------------------------------------------------------------

# Parameters go through a 0600 file, so the Google secret never shows in `ps`.
PARAMS_FILE="$(mktemp)"
chmod 600 "${PARAMS_FILE}"
trap 'rm -f "${PARAMS_FILE}"' EXIT

# Hosted-domain prefixes are global across AWS; the account id keeps ours unique.
DOMAIN_PREFIX="${COGNITO_DOMAIN_PREFIX:-${PROJECT_NAME}-${ACCOUNT_ID}}"

PROJECT_NAME="${PROJECT_NAME}" \
DOMAIN_PREFIX="${DOMAIN_PREFIX}" \
CALLBACKS="${CALLBACKS%,}" \
LOGOUTS="${LOGOUTS%,}" \
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
python3 - "${PARAMS_FILE}" <<'PY'
import json, os, sys

params = {
    "ProjectName": os.environ["PROJECT_NAME"],
    "DomainPrefix": os.environ["DOMAIN_PREFIX"],
    "CallbackUrls": os.environ["CALLBACKS"],
    "LogoutUrls": os.environ["LOGOUTS"],
    # Always passed, even empty: blanking them is how Google gets switched off.
    "GoogleClientId": os.environ["GOOGLE_CLIENT_ID"],
    "GoogleClientSecret": os.environ["GOOGLE_CLIENT_SECRET"],
}
with open(sys.argv[1], "w") as fh:
    json.dump([{"ParameterKey": k, "ParameterValue": v} for k, v in params.items()], fh)
PY

log "deploying ${STACK_NAME}"
if ! aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --parameter-overrides "file://${PARAMS_FILE}" \
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

POOL_ID="$(outputs UserPoolId)"
CLIENT_ID="$(outputs ClientId)"
DOMAIN="$(outputs Domain)"
GOOGLE="$(outputs GoogleEnabled)"

env_set COGNITO_REGION "${AWS_REGION}"
env_set COGNITO_USER_POOL_ID "${POOL_ID}"
env_set COGNITO_CLIENT_ID "${CLIENT_ID}"
env_set COGNITO_DOMAIN "${DOMAIN}"
env_set COGNITO_GOOGLE_ENABLED "${GOOGLE}"
log "wrote COGNITO_* to .env"

echo
echo "  COGNITO_REGION=${AWS_REGION}"
echo "  COGNITO_USER_POOL_ID=${POOL_ID}"
echo "  COGNITO_CLIENT_ID=${CLIENT_ID}"
echo "  COGNITO_DOMAIN=${DOMAIN}"
echo "  COGNITO_GOOGLE_ENABLED=${GOOGLE}"
echo
echo "  sign-in may return to: ${CALLBACKS%,}"
echo "  Google redirect URI:   $(outputs GoogleRedirectUri)"
echo
echo "Next: docker compose up --build (both services read these), then"
echo "make deploy-backend and make deploy-frontend to ship them."
