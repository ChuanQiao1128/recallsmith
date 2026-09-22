terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

locals {
  routes = {
    default            = { route_key = "$default", integration = "core_vpc" }
    proxy              = { route_key = "ANY /{proxy+}", integration = "core_vpc" }
    publish_jobs       = { route_key = "GET /api/v1/authoring/publish/jobs", integration = "dup_q8lfdrr" }
    premium_url        = { route_key = "GET /api/v1/content/premium-url", integration = "dup_a9dzpce" }
    premium_url_dev    = { route_key = "GET /api/v1/content/premium-url-dev", integration = "dup_q8lfdrr" }
    rc_production      = { route_key = "POST /webhooks/revenuecat/production", integration = "dup_a9dzpce" }
    rc_development     = { route_key = "POST /webhooks/revenuecat/development", integration = "dup_q8lfdrr" }
    edge_ai            = { route_key = "ANY /api/v1/ai/{proxy+}", integration = "edge_public" }
    edge_billing       = { route_key = "ANY /api/v1/billing/{proxy+}", integration = "edge_public" }
    edge_admin_cognito = { route_key = "ANY /api/v1/admin/cognito/{proxy+}", integration = "edge_public" }
  }

  integration_ids = {
    core_vpc    = aws_apigatewayv2_integration.core_vpc.id
    dup_a9dzpce = aws_apigatewayv2_integration.core_vpc_dup["a9dzpce"].id
    dup_q8lfdrr = aws_apigatewayv2_integration.core_vpc_dup["q8lfdrr"].id
    edge_public = aws_apigatewayv2_integration.edge_public.id
  }

  core_vpc_permissions = {
    "ddf85795-8ac8-5e4f-b13e-1305b00a3ba7" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/"
    "03c93ce4-7246-50e0-8573-a01d7e580e55" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/{proxy+}"
    "apigw-httpapi-ktbq1sie2c"             = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/*"
    "03895359-3cb1-5e36-9663-2926d577d284" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/webhooks/revenuecat/development"
    "8707b68d-997f-507d-8399-9bc17c4970d0" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/$default"
    "bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/content/premium-url"
    "810b76d6-7b95-567b-ac2b-5ffc1e5be696" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/webhooks/revenuecat/production"
    "1e1ab4f0-3e8d-5448-b856-e0981ab47ffc" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/content/premium-url-dev"
    "b22050a3-bad0-5ea2-a108-a21be6a9f3c0" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/authoring/publish/jobs"
  }

  edge_public_permissions = {
    "3249e15a-5957-5b6d-b271-1c7d73f1c800" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/billing/{proxy+}"
    "666d2528-5c6a-5fce-a7e9-4bbcaae132a9" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/ai/{proxy+}"
    "70ec633b-6621-5c8b-9278-9ba3d2987025" = "arn:aws:execute-api:ap-southeast-2:622994489535:ktbq1sie2c/*/*/api/v1/admin/cognito/{proxy+}"
  }
}
