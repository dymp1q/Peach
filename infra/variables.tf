variable "project_name" {
  type        = string
  description = "Prefix of every name, and the PROJECT_NAME tag."

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.project_name))
    error_message = "Lowercase letters, digits and dashes only."
  }
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

# --- sign-in (auth.tf) ------------------------------------------------------

variable "cognito_domain_prefix" {
  type        = string
  description = "Managed login lives at https://<prefix>.auth.<region>.amazoncognito.com. The Google client's redirect URI points here."
}

variable "site_url" {
  type        = string
  description = "The deployed site, e.g. https://app.example.com. Cognito sends the browser back here."
}

variable "local_url" {
  type    = string
  default = "http://localhost:5173"
}

variable "google_client_id" {
  type        = string
  description = "The Web application OAuth client from Google Cloud."
}

variable "google_client_secret" {
  type        = string
  sensitive   = true
  description = "Set in the HCP Terraform workspace as a sensitive variable, never in a file."
}

# --- weekly report (reports.tf) ---------------------------------------------

variable "mail_domain" {
  type        = string
  description = "The sender's domain, verified in SES with DKIM."
}

variable "report_recipients" {
  type        = list(string)
  description = "While SES is in the sandbox, every recipient must be a verified identity."
}

variable "report_schedule" {
  type        = string
  default     = "cron(0 7 ? * MON *)"
  description = "rate(5 minutes) for one test run, then back."
}

variable "report_fail_week" {
  type        = string
  default     = ""
  description = "Lab 5, Step 7: this one week makes the builder raise, to watch the DLQ fill."
}

# --- agenda parser (ai.tf) --------------------------------------------------

variable "parser_model" {
  type        = string
  default     = "moonshotai.kimi-k2.5"
  description = "Any model on bedrock-mantle. anthropic.* goes through the Messages API, the rest through chat completions."
}

variable "bedrock_region" {
  type    = string
  default = "us-east-1"
}

variable "budget_email" {
  type        = string
  description = "Who gets the monthly budget alarm."
}

variable "budget_limit_usd" {
  type    = number
  default = 5
}
