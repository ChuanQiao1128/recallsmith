variable "env" {
  type = string
}

variable "content_bucket_name" {
  type = string
}

variable "content_bucket_arn" {
  type = string
}

variable "content_bucket_regional_domain_name" {
  type = string
}

variable "console_bucket_name" {
  type = string
}

variable "core_vpc_role_arn" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "domain" {
  type        = string
  description = "Apex hostname, e.g. developercards.app. Every custom hostname of this module hangs under it."
}

variable "manage_domain" {
  type        = bool
  default     = false
  description = "true (prod): adopt the hosted zone, issue the two ACM certificates, create the landing site. false (staging): read the zone, use var.cloudfront_cert_arn."
}

variable "cloudfront_cert_arn" {
  type        = string
  default     = ""
  description = "us-east-1 certificate ARN used by the distributions when manage_domain = false (staging passes prod's)."
}

variable "cdn_hostname" {
  type        = string
  default     = ""
  description = "Alias of the content distribution; \"\" = cdn.<domain>."
}

variable "console_hostname" {
  type        = string
  default     = ""
  description = "Alias of the console distribution; \"\" = console.<domain>."
}

variable "site_bucket_name" {
  type        = string
  default     = ""
  description = "Landing-page bucket (prod: developercards-site-622994489535); required when manage_domain = true."
}
