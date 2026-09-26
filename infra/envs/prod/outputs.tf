output "api_id" {
  value = module.api.api_id
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "content_distribution_id" {
  value = module.edge.content_distribution_id
}

output "content_domain_name" {
  value = module.edge.content_domain_name
}

output "console_distribution_id" {
  value = module.edge.console_distribution_id
}

output "console_domain_name" {
  value = module.edge.console_domain_name
}

output "core_vpc_alias_arn" {
  value = module.api.core_vpc_alias_arn
}

output "worker_alias_arn" {
  value = module.worker.alias_arn
}

output "queue_url" {
  value = module.worker.queue_url
}

output "db_address" {
  value = module.data.db_address
}

output "console_pool_endpoint" {
  value = module.identity.console_pool_endpoint
}

output "mobile_pool_endpoint" {
  value = module.identity.mobile_pool_endpoint
}

output "alerts_topic_arn" { value = module.observability.alerts_topic_arn }

output "zone_name_servers" {
  value = module.edge.zone_name_servers
}
output "api_hostname" {
  value = module.api.api_hostname
}
output "cdn_hostname" {
  value = module.edge.cdn_hostname
}
output "console_hostname" {
  value = module.edge.console_hostname
}
output "site_hostname" {
  value = var.domain
}
output "site_distribution_id" {
  value = module.edge.site_distribution_id
}
output "cloudfront_cert_arn" {
  value = module.edge.cloudfront_cert_arn
}
output "api_cert_arn" {
  value = module.edge.api_cert_arn
}
