# R29 HARDEN (enterprise audit SEC-05, user-perspective review G11): security headers for the console and the landing
# site, replacing the AWS managed SecurityHeadersPolicy (67f7725c-…: X-Frame-Options SAMEORIGIN, no CSP) on both
# distributions. Every value lives in security_headers.json, which the console's Playwright smoke also serves the
# built bundle with (frontend/scripts/serve-with-headers.mjs), so a CSP that would block the console fails CI before
# it reaches CloudFront. The CSP is enforced (not report-only). infra/RUNBOOK.md §16: what each source is for, how to
# change one.
locals {
  security_headers = jsondecode(file("${path.module}/security_headers.json"))
  # The site distribution exists only where this module manages the domain (prod).
  security_header_targets = var.manage_domain ? ["console", "site"] : ["console"]
}

resource "aws_cloudfront_response_headers_policy" "security" {
  for_each = toset(local.security_header_targets)
  name     = "developercards-${var.env}-${each.key}-security-headers"
  comment  = "R29 HARDEN: HSTS, nosniff, DENY, referrer, permissions and the enforced CSP (modules/edge/security_headers.json)"

  security_headers_config {
    content_security_policy {
      content_security_policy = join("; ", local.security_headers.content_security_policy[each.key])
      override                = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = local.security_headers.frame_option
      override     = true
    }
    referrer_policy {
      referrer_policy = local.security_headers.referrer_policy
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = local.security_headers.strict_transport_security.max_age_sec
      include_subdomains         = local.security_headers.strict_transport_security.include_subdomains
      preload                    = local.security_headers.strict_transport_security.preload
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = local.security_headers.permissions_policy
      override = true
    }
  }
}
