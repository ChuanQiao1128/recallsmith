output "content_distribution_id" {
  value = aws_cloudfront_distribution.content.id
}

output "content_distribution_arn" {
  value = aws_cloudfront_distribution.content.arn
}

output "content_domain_name" {
  value = aws_cloudfront_distribution.content.domain_name
}

output "console_distribution_id" {
  value = aws_cloudfront_distribution.console.id
}

output "console_domain_name" {
  value = aws_cloudfront_distribution.console.domain_name
}
