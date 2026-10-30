# Paste an agenda (lab 6, was infra/ai.yml): an LLM parser on the side of Spry.
#
#   browser --POST text + Cognito token--> agenda-parser (Lambda, function URL)
#       --> a model on Amazon Bedrock (bedrock-mantle, us-east-1) --> JSON back
#   browser --POST /api/meetings/{id}/agenda--> API (ECS) --> RDS     (the save)
#
# The parser needs no database, so it runs outside the VPC and costs nothing
# while nobody pastes anything. It never writes; saving goes through the API.

resource "aws_cloudwatch_log_group" "parser" {
  name              = "/aws/lambda/${var.project_name}-agenda-parser"
  retention_in_days = 14
}

resource "aws_iam_role" "parser" {
  name               = "spry-ai-ParserRole-VKLjQrPEYkKQ"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "parser_basic" {
  role       = aws_iam_role.parser.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Call a model - and nothing else: no database, no S3, no SES.
# "*" is any model in any region; narrowing it is a class question.
resource "aws_iam_role_policy" "parser" {
  name = "call-bedrock"
  role = aws_iam_role.parser.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "bedrock-mantle:CreateInference"
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "parser" {
  function_name = "${var.project_name}-agenda-parser"
  description   = "Pasted text -> a suggested agenda, through Claude on Bedrock"
  package_type  = "Image"
  image_uri     = local.image_uri

  image_config {
    entry_point       = ["/app/.venv/bin/python", "-m", "awslambdaric"]
    command           = ["app.ai.agenda_lambda.handler"]
    working_directory = "/app"
  }

  architectures = ["arm64"]
  memory_size   = 512
  # A parse takes 2-8 s; one retry after an invalid answer doubles it.
  timeout = 30
  role    = aws_iam_role.parser.arn

  # No vpc_config: this function never touches the database.
  environment {
    variables = {
      APP_ENV           = "production"
      PARSER_MODEL      = var.parser_model
      BEDROCK_REGION    = var.bedrock_region
      COGNITO_ISSUER    = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
      COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.parser]
}

# A public HTTPS address for the function. NONE lets the browser call it; the
# handler itself checks the Cognito token and answers 401.
resource "aws_lambda_function_url" "parser" {
  function_name      = aws_lambda_function.parser.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [var.site_url, var.local_url]
    allow_methods = ["POST"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }
}

# Both are needed for a public function URL: the first lets anyone use the
# URL, the second lets that URL invoke the function.
resource "aws_lambda_permission" "parser_url" {
  function_name          = aws_lambda_function.parser.function_name
  action                 = "lambda:InvokeFunctionUrl"
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "parser_invoke" {
  function_name            = aws_lambda_function.parser.function_name
  action                   = "lambda:InvokeFunction"
  principal                = "*"
  invoked_via_function_url = true
}

# The cheapest insurance in the course: an email once the whole account's
# bill for the month passes the limit, and another when it is forecast to.
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project_name}-monthly"
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = var.budget_limit_usd
  limit_unit   = "USD"

  notification {
    notification_type          = "ACTUAL"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    notification_type          = "FORECASTED"
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    subscriber_email_addresses = [var.budget_email]
  }
}
