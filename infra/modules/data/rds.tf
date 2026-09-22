resource "aws_db_subnet_group" "default_vpc" {
  description = "Created from the RDS Management Console"
  name        = var.db_subnet_group_name
  subnet_ids  = var.subnet_ids
}

resource "aws_db_instance" "developercards" {
  allocated_storage                     = 20
  apply_immediately                     = false
  auto_minor_version_upgrade            = true
  availability_zone                     = "ap-southeast-2b"
  backup_retention_period               = 14
  backup_target                         = "region"
  backup_window                         = "12:55-13:25"
  ca_cert_identifier                    = "rds-ca-rsa2048-g1"
  copy_tags_to_snapshot                 = true
  customer_owned_ip_enabled             = false
  database_insights_mode                = "standard"
  db_subnet_group_name                  = aws_db_subnet_group.default_vpc.name
  dedicated_log_volume                  = false
  deletion_protection                   = true
  engine                                = "postgres"
  engine_lifecycle_support              = "open-source-rds-extended-support-disabled"
  engine_version                        = "17.9"
  final_snapshot_identifier             = "developercards-final-tf"
  iam_database_authentication_enabled   = false
  identifier                            = var.db_identifier
  instance_class                        = "db.t4g.micro"
  iops                                  = 3000
  kms_key_id                            = data.aws_kms_alias.rds.target_key_arn
  license_model                         = "postgresql-license"
  maintenance_window                    = "wed:17:19-wed:17:49"
  max_allocated_storage                 = 1000
  monitoring_interval                   = 60
  monitoring_role_arn                   = var.rds_monitoring_role_arn
  multi_az                              = false
  network_type                          = "IPV4"
  option_group_name                     = "default:postgres-17"
  parameter_group_name                  = "default.postgres17"
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = data.aws_kms_alias.rds.target_key_arn
  performance_insights_retention_period = 7
  port                                  = 5432
  publicly_accessible                   = false
  skip_final_snapshot                   = false
  storage_encrypted                     = true
  storage_throughput                    = 125
  storage_type                          = "gp3"
  vpc_security_group_ids                = var.rds_security_group_ids

  lifecycle {
    prevent_destroy = true
  }
}
