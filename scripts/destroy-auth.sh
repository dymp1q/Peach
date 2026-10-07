#!/usr/bin/env bash
# Delete the sign-in stack: the user pool, its users, the managed login domain
# and the Google provider. The Google OAuth client in Google Cloud stays.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT}/.env" ]]; then
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
STACK_NAME="${AUTH_STACK_NAME:-${PROJECT_NAME}-auth}"
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

printf '\033[36m==>\033[0m deleting %s (every user in the pool goes with it)\n' "${STACK_NAME}"
aws cloudformation delete-stack --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}"
printf '\033[36m==>\033[0m %s deleted\n' "${STACK_NAME}"
