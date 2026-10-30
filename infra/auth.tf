# Sign-in for the Spry site (lab 4, was infra/auth.yaml): a Cognito user pool
# where people sign up with an email and a password or continue with Google,
# Cognito's managed login page on a prefix domain, and the public web client
# the browser signs in through.
#
# Google never talks to the site: the site talks to Cognito, and Cognito talks
# to Google. Free for this project: Essentials covers 10,000 monthly users.

resource "aws_cognito_user_pool" "main" {
  name = "${var.project_name}-users"

  # Managed login needs Essentials; the first 10,000 monthly users are free.
  user_pool_tier = "ESSENTIALS"

  # People sign in with their email, not a separate username.
  username_attributes = ["email"]
  # Cognito emails a confirmation code to prove the address is theirs.
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false
  }

  # Self sign-up stays on, so anyone - the lecturer included - can register.
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Cognito's own mailer: free, 50 emails a day. A real product sends through SES.
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # Deleting the pool deletes every account in it.
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
    # Cognito fills the rest in for a Google provider; written out so the
    # plan does not try to remove them.
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  # Without the mapping a Google user arrives with no email, and the header
  # has nothing to show.
  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
    username       = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  # A public client: a browser cannot keep a secret, so it gets none (the
  # default; generate_secret is not set because changing it forces a new
  # client). PKCE protects the code exchange instead.
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  # A client that names a provider which does not exist yet fails to create.
  supported_identity_providers = ["COGNITO", aws_cognito_identity_provider.google.provider_name]

  # Exact matches, trailing slash included: /auth/callback/ is what the app sends.
  callback_urls = ["${var.site_url}/auth/callback/", "${var.local_url}/auth/callback/"]
  logout_urls   = ["${var.site_url}/", "${var.local_url}/"]

  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  # "No such user" and "wrong password" look the same to a stranger.
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "main" {
  user_pool_id = aws_cognito_user_pool.main.id
  domain       = var.cognito_domain_prefix
  # Version 2 is the new managed login (version 1 is the classic hosted UI).
  managed_login_version = 2
}

# Without a branding a version 2 domain has no sign-in page to show.
resource "aws_cognito_managed_login_branding" "web" {
  user_pool_id                = aws_cognito_user_pool.main.id
  client_id                   = aws_cognito_user_pool_client.web.id
  use_cognito_provided_values = true

  depends_on = [aws_cognito_user_pool_domain.main]
}
