resource "aws_cognito_user_pool" "console" {
  count                    = var.manage_cognito ? 1 : 0
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"
  name                     = "User pool - Console for DeveloperCards"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }
  password_policy {
    minimum_length                   = 8
    password_history_size            = 0
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }
  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }
  username_configuration {
    case_sensitive = false
  }
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }
}

resource "aws_cognito_user_pool_client" "spa" {
  count                                = var.manage_cognito ? 1 : 0
  access_token_validity                = 1
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  auth_session_validity                = 3
  callback_urls                        = ["http://localhost:5173/auth/callback", "https://d12pfy1rhi3ekm.cloudfront.net/auth/callback"]
  enable_token_revocation              = true
  id_token_validity                    = 1
  logout_urls                          = ["http://localhost:5173/", "https://d12pfy1rhi3ekm.cloudfront.net/"]
  name                                 = "My SPA app - mrj1i9"
  prevent_user_existence_errors        = "ENABLED"
  refresh_token_validity               = 5
  supported_identity_providers         = ["COGNITO"]
  user_pool_id                         = aws_cognito_user_pool.console[0].id
  token_validity_units {
    access_token  = "days"
    id_token      = "days"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_group" "super_admin" {
  count        = var.manage_cognito ? 1 : 0
  name         = "super_admin"
  precedence   = 0
  user_pool_id = aws_cognito_user_pool.console[0].id
}

resource "aws_cognito_user_group" "editor" {
  count        = var.manage_cognito ? 1 : 0
  description  = "editor"
  name         = "editor"
  precedence   = 0
  role_arn     = "arn:aws:iam::622994489535:role/service-role/developercards-api-role-l4jacdsb"
  user_pool_id = aws_cognito_user_pool.console[0].id
}

resource "aws_cognito_user_pool_domain" "console" {
  count                 = var.manage_cognito ? 1 : 0
  domain                = "ap-southeast-24vf8ucxkt"
  managed_login_version = 2
  user_pool_id          = aws_cognito_user_pool.console[0].id
}

resource "aws_cognito_user_pool" "mobile" {
  count                    = var.manage_cognito ? 1 : 0
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"
  mfa_configuration        = "OFF"
  name                     = "User pool - cpspy"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
    recovery_mechanism {
      name     = "verified_phone_number"
      priority = 2
    }
  }
  admin_create_user_config {
    allow_admin_create_user_only = false
  }
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }
  password_policy {
    minimum_length                   = 8
    password_history_size            = 0
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }
  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true
    string_attribute_constraints {
      max_length = "2048"
      min_length = "0"
    }
  }
  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }
  username_configuration {
    case_sensitive = false
  }
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }
}

resource "aws_cognito_user_pool_client" "mobile" {
  count                                = var.manage_cognito ? 1 : 0
  access_token_validity                = 60
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["email", "openid", "phone"]
  auth_session_validity                = 3
  callback_urls                        = ["https://d84l1y8p4kdic.cloudfront.net"]
  enable_token_revocation              = true
  explicit_auth_flows                  = ["ALLOW_ADMIN_USER_PASSWORD_AUTH", "ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"]
  id_token_validity                    = 60
  name                                 = "MobileDeveloperCards"
  prevent_user_existence_errors        = "ENABLED"
  refresh_token_validity               = 5
  supported_identity_providers         = ["COGNITO"]
  user_pool_id                         = aws_cognito_user_pool.mobile[0].id
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_user_pool_domain" "mobile" {
  count                 = var.manage_cognito ? 1 : 0
  domain                = "ap-southeast-204hd6iisb"
  managed_login_version = 2
  user_pool_id          = aws_cognito_user_pool.mobile[0].id
}
