#!/usr/bin/env bash
# Ask for one week's report now: the same message the Monday schedule sends,
# with the week filled in. This is how an old report is rebuilt.
#
#   make report-now WEEK=2026-W39
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
STACK_NAME="${REPORTS_STACK_NAME:-${PROJECT_NAME}-reports}"
export AWS_DEFAULT_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"

WEEK="${WEEK:-${1:-}}"
[[ "${WEEK}" =~ ^[0-9]{4}-W[0-9]{2}$ ]] \
  || { echo "usage: make report-now WEEK=2026-W39" >&2; exit 2; }

QUEUE_URL="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='RequestQueueUrl'].OutputValue" --output text)"

aws sqs send-message --queue-url "${QUEUE_URL}" \
  --message-body "{\"week\": \"${WEEK}\", \"source\": \"report-now\"}" \
  --query MessageId --output text >/dev/null
printf '\033[36m==>\033[0m asked for %s - the report lands in S3 and your inbox within a minute\n' "${WEEK}"
