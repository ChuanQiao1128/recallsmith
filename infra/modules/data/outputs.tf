output "db_instance_arn" {
  value = aws_db_instance.developercards.arn
}

output "db_address" {
  value = aws_db_instance.developercards.address
}

output "content_bucket_arn" {
  value = aws_s3_bucket.content.arn
}

output "content_bucket_regional_domain_name" {
  value = aws_s3_bucket.content.bucket_regional_domain_name
}

output "premium_bucket_arn" {
  value = aws_s3_bucket.premium.arn
}

output "subnet_ids" {
  value = var.subnet_ids
}

output "lambda_security_group_ids" {
  value = var.lambda_security_group_ids
}
