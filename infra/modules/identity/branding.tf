# A12 (R18A): the console pool's two managed-login brandings, created outside Terraform and
# adopted state-only through import blocks in infra/envs/prod/imports_r18a.tf. prevent_destroy
# on both: a replace would recreate the SPA's hosted login page.
#
# Provider facts (hashicorp/aws 6.66.0, proven by a read-only plan on 2026-09-28):
# 1. The resource takes exactly one of `settings` / `use_cognito_provided_values`; setting both
#    fails validation. spa sets `settings` only (the provider computes
#    use_cognito_provided_values = false); console_dev sets use_cognito_provided_values = true only.
# 2. The provider stores `settings` as compact JSON with lexicographically sorted keys. Plain
#    file() of the pretty-printed export plans an in-place update although the documents are
#    equal; jsonencode(jsondecode(file(...))) renders the same canonical string, so the import
#    is a no-op. spa.settings.json is the live Settings document, exported read-only; never edit it.

resource "aws_cognito_managed_login_branding" "spa" {
  count        = var.manage_cognito ? 1 : 0
  user_pool_id = aws_cognito_user_pool.console[0].id
  client_id    = aws_cognito_user_pool_client.spa[0].id
  settings     = jsonencode(jsondecode(file("${path.module}/branding/spa.settings.json")))

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_managed_login_branding" "console_dev" {
  count                       = var.manage_cognito ? 1 : 0
  user_pool_id                = aws_cognito_user_pool.console[0].id
  client_id                   = aws_cognito_user_pool_client.console_dev[0].id
  use_cognito_provided_values = true

  lifecycle {
    prevent_destroy = true
  }
}
