resource "aws_s3_bucket" "console" {
  bucket = var.console_bucket_name
}

resource "aws_s3_bucket_policy" "console" {
  bucket = aws_s3_bucket.console.id
  policy = jsonencode({
    Statement = [{
      Action = "s3:GetObject"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.console.arn
        }
      }
      Effect = "Allow"
      Principal = {
        Service = "cloudfront.amazonaws.com"
      }
      Resource = "arn:aws:s3:::${var.console_bucket_name}/*"
      Sid      = "AllowCloudFrontOAC"
    }]
    Version = "2012-10-17"
  })
}

resource "aws_s3_bucket_public_access_block" "console" {
  bucket                  = aws_s3_bucket.console.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "console" {
  bucket = aws_s3_bucket.console.id
  rule {
    blocked_encryption_types = ["SSE-C"]
    bucket_key_enabled       = false
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_ownership_controls" "console" {
  bucket = aws_s3_bucket.console.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "console" {
  bucket = aws_s3_bucket.console.id
  versioning_configuration {
    status = "Disabled"
  }
}
