#!/usr/bin/env bash
# Create or update the weekly report stack (infra/reports.yaml): the bucket,
# the S3 gateway endpoint, the queue and its DLQ, the builder and mailer
# functions, the Monday schedule and the SES identities.
#
# Everything it needs from the backend - the image, the VPC, the subnets, the
# security group the database admits, the database URL secret - is read from
# the running backend, not typed in. Deploy the backend first.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="${ROOT}/infra/reports.yaml"

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
STACK_NAME="${REPORTS_STACK_NAME:-${PROJECT_NAME}-reports}"
BACKEND_STACK="${BACKEND_STACK_NAME:-${PROJECT_NAME}-backend-ecs}"
AWS_REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
export AWS_DEFAULT_REGION="${AWS_REGION}"

# --- preflight --------------------------------------------------------------

command -v aws >/dev/null 2>&1 || die "aws is required but not installed"
aws sts get-caller-identity >/dev/null 2>&1 \
  || die "no usable AWS credentials - set AWS_PROFILE or the AWS_* keys in .env"

[[ -n "${REPORT_RECIPIENTS:-}" ]] || die "set REPORT_RECIPIENTS in .env (your real inbox)"
# The sender's domain: the site's parent domain unless set.
MAIL_DOMAIN="${REPORT_MAIL_DOMAIN:-${DOMAIN_NAME#*.}}"
[[ -n "${MAIL_DOMAIN}" ]] || die "set REPORT_MAIL_DOMAIN in .env (e.g. example.com)"
# The sandbox only delivers to verified addresses; verify the first recipient.
RECIPIENT_IDENTITY="${REPORT_RECIPIENTS%%,*}"

# --- what the backend already has -------------------------------------------

backend_param() {
  aws cloudformation describe-stacks --stack-name "${BACKEND_STACK}" \
    --query "Stacks[0].Parameters[?ParameterKey=='$1'].ParameterValue" --output text
}
backend_output() {
  aws cloudformation describe-stacks --stack-name "${BACKEND_STACK}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

aws cloudformation describe-stacks --stack-name "${BACKEND_STACK}" >/dev/null 2>&1 \
  || die "no ${BACKEND_STACK} stack - run make deploy-backend first"

IMAGE_URI="$(backend_param ImageUri)"
VPC_ID="$(backend_param VpcId)"
SUBNET_IDS="$(backend_param SubnetIds)"
SECRET_ARN="$(backend_output DatabaseUrlSecretArn)"
SERVICE_SG="$(aws ecs describe-services \
  --cluster "$(backend_output ClusterName)" --services "$(backend_output ServiceName)" \
  --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups[0]' --output text)"
# Every route table in the VPC: the subnets' own, or the main one they fall back to.
ROUTE_TABLES="$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=${VPC_ID}" \
  --query 'RouteTables[].RouteTableId' --output text | tr '\t' ',')"

log "image          ${IMAGE_URI}"
log "vpc            ${VPC_ID} (route tables ${ROUTE_TABLES})"
log "mail           reports@${MAIL_DOMAIN} -> ${REPORT_RECIPIENTS}"

# --- deploy -----------------------------------------------------------------

log "deploying ${STACK_NAME} in ${AWS_REGION}"

if ! aws cloudformation deploy \
  --stack-name "${STACK_NAME}" \
  --template-file "${TEMPLATE}" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "ProjectName=${PROJECT_NAME}" \
    "ImageUri=${IMAGE_URI}" \
    "VpcId=${VPC_ID}" \
    "SubnetIds=${SUBNET_IDS}" \
    "RouteTableIds=${ROUTE_TABLES}" \
    "ServiceSecurityGroupId=${SERVICE_SG}" \
    "DatabaseUrlSecretArn=${SECRET_ARN}" \
    "MailDomain=${MAIL_DOMAIN}" \
    "Recipients=${REPORT_RECIPIENTS}" \
    "RecipientIdentity=${RECIPIENT_IDENTITY}" \
    "ScheduleExpression=${REPORT_SCHEDULE:-cron(0 7 ? * MON *)}" \
    "FailWeek=${REPORT_FAIL_WEEK:-}" \
  --no-fail-on-empty-changeset \
  --tags "PROJECT_NAME=${PROJECT_NAME}"; then
  warn "deploy failed - most recent failure reasons:"
  aws cloudformation describe-stack-events --stack-name "${STACK_NAME}" \
    --max-items 40 \
    --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`||ResourceStatus==`UPDATE_FAILED`].[LogicalResourceId,ResourceStatusReason]' \
    --output table >&2 || true
  exit 1
fi

# --- report -----------------------------------------------------------------

outputs() {
  aws cloudformation describe-stacks --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

echo
echo "  bucket     s3://$(outputs ReportsBucket)/reports/"
echo "  queue      $(outputs RequestQueueUrl)"
echo "  dlq        $(outputs DeadLetterQueueUrl)"
echo "  schedule   ${REPORT_SCHEDULE:-cron(0 7 ? * MON *)} Europe/Kyiv"
echo
DKIM_STATUS="$(aws sesv2 get-email-identity --email-identity "${MAIL_DOMAIN}" \
  --query 'DkimAttributes.Status' --output text 2>/dev/null || echo unknown)"
if [[ "${DKIM_STATUS}" != "SUCCESS" ]]; then
  echo "SES is not verified for ${MAIL_DOMAIN} yet (${DKIM_STATUS}). Add these CNAMEs at your DNS provider:"
  echo
  for i in 1 2 3; do echo "  $(outputs "DkimRecord${i}")"; done
  echo
fi
echo "Then: make report-now WEEK=2026-W40"
echo
