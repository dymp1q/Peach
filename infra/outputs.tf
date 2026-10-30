# Everything the Makefile and the frontend build read: terraform output -raw <name>.

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "authority" {
  description = "The OIDC issuer the frontend's library discovers endpoints from."
  value       = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}

output "cognito_domain" {
  description = "Managed login, and the base of the /logout endpoint."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com"
}

output "google_redirect_uri" {
  description = "Paste into the Google OAuth client's authorised redirect URIs."
  value       = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${local.region}.amazoncognito.com/oauth2/idpresponse"
}

output "reports_bucket" {
  value = aws_s3_bucket.reports.id
}

output "request_queue_url" {
  value = aws_sqs_queue.requests.url
}

output "dead_letter_queue_url" {
  value = aws_sqs_queue.requests_dlq.url
}

output "builder_function_name" {
  value = aws_lambda_function.builder.function_name
}

output "mailer_function_name" {
  value = aws_lambda_function.mailer.function_name
}

output "dkim_records" {
  description = "CNAME name -> value, at the DNS provider."
  value = [
    for t in aws_sesv2_email_identity.mail_domain.dkim_signing_attributes[0].tokens :
    "${t}._domainkey.${var.mail_domain} -> ${t}.dkim.amazonses.com"
  ]
}

output "parser_url" {
  description = "The browser posts pasted text here (VITE_PARSER_URL)."
  value       = aws_lambda_function_url.parser.function_url
}

output "parser_function_name" {
  value = aws_lambda_function.parser.function_name
}
