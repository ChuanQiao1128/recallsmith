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

output "zone_id" {
  value = local.zone_id
}

output "zone_name_servers" {
  value = try(aws_route53_zone.main[0].name_servers, [])
}

output "cloudfront_cert_arn" {
  value = local.cloudfront_cert_arn
}

output "api_cert_arn" {
  value = try(aws_acm_certificate_validation.api[0].certificate_arn, "")
}

output "site_distribution_id" {
  value = try(aws_cloudfront_distribution.site[0].id, "")
}

output "cdn_hostname" {
  value = local.cdn_hostname
}

output "console_hostname" {
  value = local.console_hostname
}
