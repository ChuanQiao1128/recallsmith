# E01 adoption set — never edited after E01 (E00 §1.1, §5, §6 #20)

# identity
import {
  to = module.identity.aws_iam_role.core_vpc
  id = "core-vpc-role-joizyiwt"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_exec"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["ec2_full"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonEC2FullAccess"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["rds_full"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonRDSFullAccess"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["sqs_full"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonSQSFullAccess"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["s3_full"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::aws:policy/AmazonS3FullAccess"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["logs"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.core_vpc["vpc"]
  id = "core-vpc-role-joizyiwt/arn:aws:iam::622994489535:policy/service-role/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db"
}
import {
  to = module.identity.aws_iam_policy.core_vpc_logs
  id = "arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-033fad1a-ba7b-4152-ba28-7cf61f0c3423"
}
import {
  to = module.identity.aws_iam_policy.core_vpc_vpc
  id = "arn:aws:iam::622994489535:policy/service-role/AWSLambdaVPCAccessExecutionRole-0916ae0e-b0bc-43bf-9827-cf383da694db"
}
import {
  to = module.identity.aws_iam_role.edge_public
  id = "edge-public-role-zezx326f"
}
import {
  to = module.identity.aws_iam_role_policy.edge_public_cognito
  id = "edge-public-role-zezx326f:edge-public-cognito"
}
import {
  to = module.identity.aws_iam_policy.edge_public_logs
  id = "arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.edge_public_logs
  id = "edge-public-role-zezx326f/arn:aws:iam::622994489535:policy/service-role/AWSLambdaBasicExecutionRole-4587d025-3600-45c8-9409-a1ead0afc685"
}
import {
  to = module.identity.aws_iam_role.snowflake
  id = "snowflake-recallsmith-s3-role"
}
import {
  to = module.identity.aws_iam_policy.snowflake_read
  id = "arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.snowflake["read"]
  id = "snowflake-recallsmith-s3-role/arn:aws:iam::622994489535:policy/snowflake-recallsmith-s3-read"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.snowflake["s3_full"]
  id = "snowflake-recallsmith-s3-role/arn:aws:iam::aws:policy/AmazonS3FullAccess"
}
import {
  to = module.identity.aws_iam_role.rds_monitoring
  id = "rds-monitoring-role"
}
import {
  to = module.identity.aws_iam_role_policy_attachment.rds_monitoring
  id = "rds-monitoring-role/arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
import {
  to = module.identity.aws_cognito_user_pool.console[0]
  id = "ap-southeast-2_4Vf8uCXKt"
}
import {
  to = module.identity.aws_cognito_user_pool_client.spa[0]
  id = "ap-southeast-2_4Vf8uCXKt/6lkofepp2llp6v4nueg52mcm5v"
}
import {
  to = module.identity.aws_cognito_user_group.super_admin[0]
  id = "ap-southeast-2_4Vf8uCXKt/super_admin"
}
import {
  to = module.identity.aws_cognito_user_group.editor[0]
  id = "ap-southeast-2_4Vf8uCXKt/editor"
}
import {
  to = module.identity.aws_cognito_user_pool_domain.console[0]
  id = "ap-southeast-24vf8ucxkt"
}
import {
  to = module.identity.aws_cognito_user_pool.mobile[0]
  id = "ap-southeast-2_04hd6iisb"
}
import {
  to = module.identity.aws_cognito_user_pool_client.mobile[0]
  id = "ap-southeast-2_04hd6iisb/7agirr7f56r9k5p6v6o63al1on"
}
import {
  to = module.identity.aws_cognito_user_pool_domain.mobile[0]
  id = "ap-southeast-204hd6iisb"
}

# data
import {
  to = module.data.aws_db_instance.developercards
  id = "developercards"
}
import {
  to = module.data.aws_db_subnet_group.default_vpc
  id = "default-vpc-04af44dd8f5f48717"
}
import {
  to = module.data.aws_s3_bucket.content
  id = "core-vpc"
}
import {
  to = module.data.aws_s3_bucket_versioning.content
  id = "core-vpc"
}
import {
  to = module.data.aws_s3_bucket_public_access_block.content
  id = "core-vpc"
}
import {
  to = module.data.aws_s3_bucket_server_side_encryption_configuration.content
  id = "core-vpc"
}
import {
  to = module.data.aws_s3_bucket_ownership_controls.content
  id = "core-vpc"
}
import {
  to = module.data.aws_s3_bucket.premium
  id = "core-vpc-premium"
}
import {
  to = module.data.aws_s3_bucket_versioning.premium
  id = "core-vpc-premium"
}
import {
  to = module.data.aws_s3_bucket_public_access_block.premium
  id = "core-vpc-premium"
}
import {
  to = module.data.aws_s3_bucket_server_side_encryption_configuration.premium
  id = "core-vpc-premium"
}
import {
  to = module.data.aws_s3_bucket_ownership_controls.premium
  id = "core-vpc-premium"
}

# edge
import {
  to = module.edge.aws_s3_bucket_policy.content
  id = "core-vpc"
}
import {
  to = module.edge.aws_cloudfront_distribution.content
  id = "E28BKORJLV6UXG"
}
import {
  to = module.edge.aws_cloudfront_distribution.console
  id = "E85FKUMZZWQWX"
}
import {
  to = module.edge.aws_cloudfront_origin_access_control.content
  id = "E2O3Q2DB6GEBDD"
}
import {
  to = module.edge.aws_cloudfront_origin_access_control.console
  id = "E13T84KBR8KQT6"
}
import {
  to = module.edge.aws_wafv2_web_acl.content
  id = "0ee57e07-7ee4-4953-8eac-e784c14e198c/CreatedByCloudFront-fbfe7e00/CLOUDFRONT"
}
import {
  to = module.edge.aws_s3_bucket.console
  id = "recallsmith-console-622994489535"
}
import {
  to = module.edge.aws_s3_bucket_policy.console
  id = "recallsmith-console-622994489535"
}
import {
  to = module.edge.aws_s3_bucket_public_access_block.console
  id = "recallsmith-console-622994489535"
}
import {
  to = module.edge.aws_s3_bucket_server_side_encryption_configuration.console
  id = "recallsmith-console-622994489535"
}
import {
  to = module.edge.aws_s3_bucket_ownership_controls.console
  id = "recallsmith-console-622994489535"
}
import {
  to = module.edge.aws_s3_bucket_versioning.console
  id = "recallsmith-console-622994489535"
}

# api
import {
  to = module.api.aws_apigatewayv2_api.http
  id = "ktbq1sie2c"
}
import {
  to = module.api.aws_apigatewayv2_integration.core_vpc
  id = "ktbq1sie2c/ftkbtwn"
}
import {
  to = module.api.aws_apigatewayv2_integration.core_vpc_dup["a9dzpce"]
  id = "ktbq1sie2c/a9dzpce"
}
import {
  to = module.api.aws_apigatewayv2_integration.core_vpc_dup["q8lfdrr"]
  id = "ktbq1sie2c/q8lfdrr"
}
import {
  to = module.api.aws_apigatewayv2_integration.edge_public
  id = "ktbq1sie2c/wf11obg"
}
import {
  to = module.api.aws_apigatewayv2_route.this["default"]
  id = "ktbq1sie2c/2zt7dan"
}
import {
  to = module.api.aws_apigatewayv2_route.this["proxy"]
  id = "ktbq1sie2c/xhcsm7a"
}
import {
  to = module.api.aws_apigatewayv2_route.this["publish_jobs"]
  id = "ktbq1sie2c/3o410l1"
}
import {
  to = module.api.aws_apigatewayv2_route.this["premium_url"]
  id = "ktbq1sie2c/cz7p5uo"
}
import {
  to = module.api.aws_apigatewayv2_route.this["premium_url_dev"]
  id = "ktbq1sie2c/ymw0s2h"
}
import {
  to = module.api.aws_apigatewayv2_route.this["rc_production"]
  id = "ktbq1sie2c/daeaq4a"
}
import {
  to = module.api.aws_apigatewayv2_route.this["rc_development"]
  id = "ktbq1sie2c/jsyx1bu"
}
import {
  to = module.api.aws_apigatewayv2_route.this["edge_ai"]
  id = "ktbq1sie2c/6lnq0za"
}
import {
  to = module.api.aws_apigatewayv2_route.this["edge_billing"]
  id = "ktbq1sie2c/w6hhydi"
}
import {
  to = module.api.aws_apigatewayv2_route.this["edge_admin_cognito"]
  id = "ktbq1sie2c/l803chb"
}
import {
  to = module.api.aws_apigatewayv2_authorizer.console
  id = "ktbq1sie2c/828ehi"
}
import {
  to = module.api.aws_apigatewayv2_stage.default
  id = "ktbq1sie2c/$default"
}
import {
  to = module.api.aws_apigatewayv2_stage.dev
  id = "ktbq1sie2c/dev"
}
import {
  to = module.api.aws_cloudwatch_log_group.core_vpc
  id = "/aws/lambda/core-vpc"
}
import {
  to = module.api.aws_cloudwatch_log_group.edge_public
  id = "/aws/lambda/edge-public"
}
import {
  to = module.api.aws_lambda_function.core_vpc
  id = "core-vpc"
}
import {
  to = module.api.aws_lambda_alias.core_vpc_prod
  id = "core-vpc/prod"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["ddf85795-8ac8-5e4f-b13e-1305b00a3ba7"]
  id = "core-vpc/ddf85795-8ac8-5e4f-b13e-1305b00a3ba7"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["03c93ce4-7246-50e0-8573-a01d7e580e55"]
  id = "core-vpc/03c93ce4-7246-50e0-8573-a01d7e580e55"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["apigw-httpapi-ktbq1sie2c"]
  id = "core-vpc/apigw-httpapi-ktbq1sie2c"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["03895359-3cb1-5e36-9663-2926d577d284"]
  id = "core-vpc/03895359-3cb1-5e36-9663-2926d577d284"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["8707b68d-997f-507d-8399-9bc17c4970d0"]
  id = "core-vpc/8707b68d-997f-507d-8399-9bc17c4970d0"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af"]
  id = "core-vpc/bf0bd0f4-d44d-5e2f-9852-8c2a30bbc9af"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["810b76d6-7b95-567b-ac2b-5ffc1e5be696"]
  id = "core-vpc/810b76d6-7b95-567b-ac2b-5ffc1e5be696"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["1e1ab4f0-3e8d-5448-b856-e0981ab47ffc"]
  id = "core-vpc/1e1ab4f0-3e8d-5448-b856-e0981ab47ffc"
}
import {
  to = module.api.aws_lambda_permission.core_vpc["b22050a3-bad0-5ea2-a108-a21be6a9f3c0"]
  id = "core-vpc/b22050a3-bad0-5ea2-a108-a21be6a9f3c0"
}
import {
  to = module.api.aws_lambda_function.edge_public
  id = "edge-public"
}
import {
  to = module.api.aws_lambda_permission.edge_public["3249e15a-5957-5b6d-b271-1c7d73f1c800"]
  id = "edge-public/3249e15a-5957-5b6d-b271-1c7d73f1c800"
}
import {
  to = module.api.aws_lambda_permission.edge_public["666d2528-5c6a-5fce-a7e9-4bbcaae132a9"]
  id = "edge-public/666d2528-5c6a-5fce-a7e9-4bbcaae132a9"
}
import {
  to = module.api.aws_lambda_permission.edge_public["70ec633b-6621-5c8b-9278-9ba3d2987025"]
  id = "edge-public/70ec633b-6621-5c8b-9278-9ba3d2987025"
}

# worker
import {
  to = module.worker.aws_sqs_queue.publish_jobs
  id = "https://sqs.ap-southeast-2.amazonaws.com/622994489535/recallsmith-publish-jobs"
}
import {
  to = module.worker.aws_lambda_function.worker
  id = "worker-lambda"
}
import {
  to = module.worker.aws_lambda_alias.worker_prod
  id = "worker-lambda/prod"
}
import {
  to = module.worker.aws_lambda_event_source_mapping.worker_sqs
  id = "29e34447-aedd-45cf-8cab-c6ca9ad94f2f"
}
import {
  to = module.worker.aws_cloudwatch_log_group.worker
  id = "/aws/lambda/worker-lambda"
}

# observability
import {
  to = module.observability.aws_budgets_budget.monthly
  id = "622994489535:My Monthly Cost Budget"
}
