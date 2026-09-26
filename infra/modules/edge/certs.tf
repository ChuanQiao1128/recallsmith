# Two wildcard certificates (apex + *.domain): us-east-1 for CloudFront, regional for
# API Gateway. ACM issues the SAME validation CNAME for the apex and its wildcard, and
# the same one in every region of one account, so one Route 53 record validates both.
locals {
  cloudfront_cert_arn = var.manage_domain ? one(aws_acm_certificate_validation.cloudfront[*].certificate_arn) : var.cloudfront_cert_arn

  # ACM issues the SAME validation CNAME for the apex and its wildcard, so one record
  # validates both; keep only the apex option. Grouped under the constant "apex" key (the
  # trailing `...`) so the validation record's for_each key is known at plan time while the
  # certificate — and its record name/value — is still being created (TF 1.16 / aws 6.66
  # cannot determine an `if`-filtered map's keys from a to-be-created cert otherwise).
  cert_validation_options = {
    for dvo in flatten(aws_acm_certificate.cloudfront[*].domain_validation_options) :
    "apex" => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }...
    if dvo.domain_name == var.domain
  }
}

resource "aws_acm_certificate" "cloudfront" {
  count                     = var.manage_domain ? 1 : 0
  provider                  = aws.use1
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate" "api" {
  count                     = var.manage_domain ? 1 : 0
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.manage_domain ? toset(["apex"]) : toset([])

  allow_overwrite = true
  zone_id         = local.zone_id
  name            = local.cert_validation_options[each.key][0].name
  type            = local.cert_validation_options[each.key][0].type
  ttl             = 60
  records         = [local.cert_validation_options[each.key][0].value]
}

resource "aws_acm_certificate_validation" "cloudfront" {
  count                   = var.manage_domain ? 1 : 0
  provider                = aws.use1
  certificate_arn         = aws_acm_certificate.cloudfront[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_acm_certificate_validation" "api" {
  count                   = var.manage_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}
