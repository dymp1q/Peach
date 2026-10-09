#!/usr/bin/env bash
# Delete the report stack. The bucket is emptied first: CloudFormation cannot
# delete a bucket that still holds reports.
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

BUCKET="$(aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
  --query "Stacks[0].Outputs[?OutputKey=='ReportsBucket'].OutputValue" --output text 2>/dev/null || true)"
if [[ -n "${BUCKET}" && "${BUCKET}" != "None" ]]; then
  printf '\033[36m==>\033[0m emptying s3://%s\n' "${BUCKET}"
  aws s3 rm "s3://${BUCKET}" --recursive --only-show-errors
fi

printf '\033[36m==>\033[0m deleting %s\n' "${STACK_NAME}"
aws cloudformation delete-stack --stack-name "${STACK_NAME}"
aws cloudformation wait stack-delete-complete --stack-name "${STACK_NAME}"
printf '\033[36m==>\033[0m %s deleted\n' "${STACK_NAME}"
