# R18A A11 — SES for the automation emails (A00 §12.1): the developercards.app domain identity with Easy DKIM
# (three CNAMEs in the adopted zone), the custom MAIL FROM mail.<domain> (MX + SPF), a report-less DMARC record,
# the configuration set the notifier sends through, and the recipient identity. The account is in the SES sandbox,
# so the recipient must be verified: creating it makes SES email the owner a verification link. The recipient is
# var.notify_recipient_email (the sensitive root alert_email); it is never printed.

data "aws_region" "current" {}

# No default configuration set: the notifier names it on every send.
resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.domain

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# The tokens are unknown until apply; the count is fixed (Easy DKIM always issues three).
resource "aws_route53_record" "ses_dkim" {
  count   = 3
  zone_id = local.zone_id
  name    = "${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  email_identity         = aws_sesv2_email_identity.domain.email_identity
  mail_from_domain       = "mail.${var.domain}"
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  zone_id = local.zone_id
  name    = "mail.${var.domain}"
  type    = "MX"
  ttl     = 1800
  records = ["10 feedback-smtp.${data.aws_region.current.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  zone_id = local.zone_id
  name    = "mail.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=spf1 include:amazonses.com ~all"]
}

# Monitoring policy only; no rua because no mailbox exists at the domain.
resource "aws_route53_record" "dmarc" {
  zone_id = local.zone_id
  name    = "_dmarc.${var.domain}"
  type    = "TXT"
  ttl     = 1800
  records = ["v=DMARC1; p=none; adkim=r; aspf=r"]
}

resource "aws_sesv2_configuration_set" "automation" {
  configuration_set_name = var.ses_configuration_set_name

  reputation_options {
    reputation_metrics_enabled = true
  }

  sending_options {
    sending_enabled = true
  }

  suppression_options {
    suppressed_reasons = ["BOUNCE", "COMPLAINT"]
  }
}

# Sandbox recipient (sensitive). Changing alert_email replaces it and SES sends a new verification link.
resource "aws_sesv2_email_identity" "notify_recipient" {
  email_identity = var.notify_recipient_email
}
