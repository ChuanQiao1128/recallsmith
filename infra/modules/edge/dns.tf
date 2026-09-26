# Hosted zone + alias records. The zone was created by Route 53 Domains on 2026-09-22
# (registrar comment kept verbatim so the adoption is a no-op); staging reads it.
locals {
  record_types      = toset(["A", "AAAA"])
  site_record_types = var.manage_domain ? local.record_types : toset([])
  cdn_hostname      = var.cdn_hostname != "" ? var.cdn_hostname : "cdn.${var.domain}"
  console_hostname  = var.console_hostname != "" ? var.console_hostname : "console.${var.domain}"
  zone_id           = coalesce(one(aws_route53_zone.main[*].zone_id), one(data.aws_route53_zone.main[*].zone_id))
}

resource "aws_route53_zone" "main" {
  count   = var.manage_domain ? 1 : 0
  name    = var.domain
  comment = "HostedZone created by Route53 Registrar"

  lifecycle {
    prevent_destroy = true
    # The registrar-created zone has no force_destroy in its imported state (null); the
    # schema default (false) would otherwise register as a spurious null -> false change on
    # the adoption plan. Ignoring it keeps adoption a tags-only no-op (E00 §2.9.1 intent).
    ignore_changes = [force_destroy]
  }
}

data "aws_route53_zone" "main" {
  count        = var.manage_domain ? 0 : 1
  name         = var.domain
  private_zone = false
}

resource "aws_route53_record" "cdn" {
  for_each = local.record_types
  zone_id  = local.zone_id
  name     = local.cdn_hostname
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.content.domain_name
    zone_id                = aws_cloudfront_distribution.content.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "console" {
  for_each = local.record_types
  zone_id  = local.zone_id
  name     = local.console_hostname
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.console.domain_name
    zone_id                = aws_cloudfront_distribution.console.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_apex" {
  for_each = local.site_record_types
  zone_id  = local.zone_id
  name     = var.domain
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.site[0].domain_name
    zone_id                = aws_cloudfront_distribution.site[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "site_www" {
  for_each = local.site_record_types
  zone_id  = local.zone_id
  name     = "www.${var.domain}"
  type     = each.key

  alias {
    name                   = aws_cloudfront_distribution.site[0].domain_name
    zone_id                = aws_cloudfront_distribution.site[0].hosted_zone_id
    evaluate_target_health = false
  }
}
