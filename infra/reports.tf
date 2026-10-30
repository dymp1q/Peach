# The weekly meetings report (lab 5, was infra/reports.yaml), built by events.
# Nobody clicks anything:
#
#   EventBridge Scheduler (Mon 07:00 Kyiv) --message--> SQS report-requests
#   make report-now WEEK=2026-W39        --message--> SQS report-requests
#   SQS --(3 tries, then the DLQ)--> report-builder (Lambda, in the VPC)
#       reads RDS, writes reports/<week>.csv to S3 through the gateway endpoint
#   S3 ObjectCreated reports/*.csv --> report-mailer (Lambda, outside the VPC)
#       downloads the file, emails it as an attachment through SES
#
# Why two functions: the builder sits in the VPC to reach the database, and
# the VPC has no NAT gateway, so it cannot reach SES. The mailer can, and
# never touches the database.

locals {
  reports_bucket = "${var.project_name}-reports-${local.account_id}"
}

# --- storage -----------------------------------------------------------------

resource "aws_s3_bucket" "reports" {
  bucket = local.reports_bucket

  # Every report lives here.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    id     = "delete-old-reports"
    status = "Enabled"

    filter {
      prefix = "reports/"
    }

    expiration {
      days = 90
    }
  }
}

# In CloudFormation this was a property of the bucket, which made a circular
# dependency with the permission. Here the bucket, the permission and the
# notification are three resources, and the references order them.
resource "aws_s3_bucket_notification" "reports" {
  bucket = aws_s3_bucket.reports.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.mailer.arn
    events              = ["s3:ObjectCreated:*"]
    filter_prefix       = "reports/"
    filter_suffix       = ".csv"
  }

  depends_on = [aws_lambda_permission.mailer_from_s3]
}

# Free. Without it the builder's PutObject has nowhere to go and hangs until
# the timeout: the subnets have no NAT, and Lambda gets no public IP.
resource "aws_vpc_endpoint" "s3" {
  vpc_endpoint_type = "Gateway"
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${local.region}.s3"
  route_table_ids   = data.aws_route_tables.vpc.ids
}

# --- the queue ---------------------------------------------------------------

resource "aws_sqs_queue" "requests_dlq" {
  name                      = "${var.project_name}-report-requests-dlq"
  message_retention_seconds = 1209600 # 14 days, the maximum
  max_message_size          = 1048576 # 1 MiB, the queue's default since 2025
}

resource "aws_sqs_queue" "requests" {
  name = "${var.project_name}-report-requests"
  # 6 x the builder's 90 s timeout. Shorter, and a message could become
  # visible again while the first attempt is still running, starting a second
  # builder on the same report.
  visibility_timeout_seconds = 540
  max_message_size           = 1048576

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.requests_dlq.arn
    maxReceiveCount     = 3
  })
}

# --- the builder (in the VPC) ------------------------------------------------

resource "aws_cloudwatch_log_group" "builder" {
  name              = "/aws/lambda/${var.project_name}-report-builder"
  retention_in_days = 14
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# The role names are the ones CloudFormation generated: a new name would be a
# new role, not an imported one.
resource "aws_iam_role" "builder" {
  name               = "spry-reports-BuilderRole-Giao2WMJPXig"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Network interfaces in the VPC, plus CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "builder_vpc" {
  role       = aws_iam_role.builder.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "builder" {
  name = "write-reports-read-queue"
  role = aws_iam_role.builder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:PutObject"
        Resource = "arn:aws:s3:::${local.reports_bucket}/reports/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = aws_sqs_queue.requests.arn
      },
    ]
  })
}

resource "aws_lambda_function" "builder" {
  function_name = "${var.project_name}-report-builder"
  description   = "Builds reports/<week>.csv from the database"
  package_type  = "Image"
  image_uri     = local.image_uri

  # The ECS image runs uvicorn; here the runtime interface client runs the
  # report handler instead.
  image_config {
    entry_point       = ["/app/.venv/bin/python", "-m", "awslambdaric"]
    command           = ["app.reports.lambda_handler.handler"]
    working_directory = "/app"
  }

  architectures = ["arm64"]
  memory_size   = 512
  # At least 60 s in the lab, for a database that may be resuming.
  timeout = 90
  role    = aws_iam_role.builder.arn

  vpc_config {
    subnet_ids         = local.subnet_ids
    security_group_ids = [data.aws_security_group.api.id]
  }

  environment {
    variables = {
      APP_ENV        = "production"
      REPORTS_BUCKET = local.reports_bucket
      DATABASE_URL   = data.aws_secretsmanager_secret_version.database_url.secret_string
      FAIL_WEEK      = var.report_fail_week
    }
  }

  depends_on = [aws_cloudwatch_log_group.builder]
}

# The Lambda service polls the queue and invokes the builder; the builder
# itself never connects to SQS, which is why it works with no NAT.
resource "aws_lambda_event_source_mapping" "builder" {
  event_source_arn = aws_sqs_queue.requests.arn
  function_name    = aws_lambda_function.builder.arn
  batch_size       = 1
}

# --- the schedule ------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name = "spry-reports-SchedulerRole-Mh0zN60V2GwB"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account_id }
      }
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "send-report-requests"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.requests.arn
    }]
  })
}

resource "aws_scheduler_schedule" "weekly" {
  name                = "${var.project_name}-weekly-report"
  description         = "Every Monday 07:00 Kyiv time, ask for last week's report"
  schedule_expression = var.report_schedule
  # Without it the cron runs in UTC, and the report arrives at 9 or 10
  # depending on daylight saving time.
  schedule_expression_timezone = "Europe/Kyiv"
  state                        = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_sqs_queue.requests.arn
    role_arn = aws_iam_role.scheduler.arn
    # No week: the builder takes the week that just ended.
    input = "{\"week\": null, \"source\": \"schedule\"}"
  }
}

# --- the mailer (outside the VPC) --------------------------------------------

resource "aws_cloudwatch_log_group" "mailer" {
  name              = "/aws/lambda/${var.project_name}-report-mailer"
  retention_in_days = 14
}

resource "aws_iam_role" "mailer" {
  name               = "spry-reports-MailerRole-PE8Iholc9DrS"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "mailer_basic" {
  role       = aws_iam_role.mailer.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Read reports, send mail. Nothing here can write to reports/: a function
# triggered by uploads there that uploads there would call itself forever.
resource "aws_iam_role_policy" "mailer" {
  name = "read-reports-send-mail"
  role = aws_iam_role.mailer.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:GetObject"
        Resource = "arn:aws:s3:::${local.reports_bucket}/reports/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
    ]
  })
}

data "archive_file" "mailer" {
  type        = "zip"
  source_file = "${path.module}/mailer/index.py"
  output_path = "${path.module}/.build/mailer.zip"
}

resource "aws_lambda_function" "mailer" {
  function_name    = "${var.project_name}-report-mailer"
  description      = "Emails each new reports/*.csv as an attachment through SES"
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "index.handler"
  memory_size      = 256
  timeout          = 30
  role             = aws_iam_role.mailer.arn
  filename         = data.archive_file.mailer.output_path
  source_code_hash = data.archive_file.mailer.output_base64sha256

  environment {
    variables = {
      SENDER     = "Spry reports <reports@${var.mail_domain}>"
      RECIPIENTS = join(",", var.report_recipients)
    }
  }

  depends_on = [aws_cloudwatch_log_group.mailer]
}

resource "aws_lambda_permission" "mailer_from_s3" {
  function_name  = aws_lambda_function.mailer.function_name
  action         = "lambda:InvokeFunction"
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.reports.arn
  source_account = local.account_id
}

# --- SES ---------------------------------------------------------------------

# Three DKIM CNAMEs to add at the DNS provider (outputs.tf); verified a few
# minutes after they resolve.
resource "aws_sesv2_email_identity" "mail_domain" {
  email_identity = var.mail_domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# The sandbox sends only to verified addresses. Creating this emails the
# address a link to click.
resource "aws_sesv2_email_identity" "recipient" {
  email_identity = var.report_recipients[0]
}
