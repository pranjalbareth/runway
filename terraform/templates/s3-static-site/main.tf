terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "env_name" {
  type = string
}
variable "env_id" {
  type = string
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
}
variable "app_port" {
  type    = number
  default = 80
}
variable "infra_mode" {
  type    = string
  default = "local"
}
variable "mockcloud_endpoint" {
  type    = string
  default = ""
}
variable "aws_region" {
  type    = string
  default = "us-east-1"
}

locals {
  endpoint = var.infra_mode == "local" ? (
    length(var.mockcloud_endpoint) > 0 ? var.mockcloud_endpoint : "http://localhost:4566"
  ) : null
}

provider "aws" {
  region                      = var.infra_mode == "local" ? "us-east-1" : var.aws_region
  access_key                  = var.infra_mode == "local" ? "mock" : null
  secret_key                  = var.infra_mode == "local" ? "mock" : null
  skip_credentials_validation = var.infra_mode == "local"
  skip_requesting_account_id  = var.infra_mode == "local"
  skip_metadata_api_check     = var.infra_mode == "local"
  # Force path-style S3 URLs (bucket.localhost doesn't resolve locally)
  s3_use_path_style           = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content { s3 = local.endpoint }
  }
}

resource "aws_s3_bucket" "site" {
  bucket = "runway-${var.env_name}-site"
  tags   = { managed-by = "runway", env-id = var.env_id }
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = false
  ignore_public_acls      = false
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  index_document { suffix = "index.html" }
  error_document { key    = "error.html" }
}

resource "aws_s3_bucket_acl" "site" {
  depends_on = [aws_s3_bucket_public_access_block.site]
  bucket     = aws_s3_bucket.site.id
  acl        = "public-read"
}

output "bucket_name"   { value = aws_s3_bucket.site.id }
output "website_url"   { value = aws_s3_bucket_website_configuration.site.website_endpoint }
output "env_id"        { value = var.env_id }
