terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

variable "env_name" {
  type = string
}
variable "env_id" {
  type = string
}
variable "app_port" {
  type    = number
  default = 443
}
variable "instance_type" {
  type    = string
  default = "t3.micro"
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
  # MockCloud only understands path-style S3 URLs (PUT /bucket). Without this
  # the provider sends virtual-hosted (Host: bucket.s3.amazonaws.com) and
  # MockCloud mis-parses every PUT into BucketAlreadyExists.
  s3_use_path_style = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      lambda     = local.endpoint
      s3         = local.endpoint
      iam        = local.endpoint
      dynamodb   = local.endpoint
      events     = local.endpoint
      cloudwatch = local.endpoint
      sts        = local.endpoint
    }
  }
}

data "archive_file" "transformer" {
  type        = "zip"
  output_path = "${path.module}/transformer.zip"
  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => {
        const records = (event.detail && event.detail.records) || [event]
        console.log("Cargo transformer (${var.env_name}) received", records.length, "records")
        return { ingested: records.length }
      }
    EOT
  }
}

resource "aws_iam_role" "transformer_role" {
  name = "runway-${var.env_name}-cargo-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# ── S3 ingest bucket ──
# force_destroy lets terraform clean up on destroy. The terraform.js
# LOCAL_HOOKS pre-deletes any stale bucket of the same name in MockCloud
# before each apply, so retries don't hit BucketAlreadyExists.
resource "aws_s3_bucket" "ingest" {
  # Bucket name includes a slice of env_id so MockCloud's persistent S3
  # namespace can't collide across provisions. Backend's LOCAL_HOOKS
  # computes the same name (see backend/lib/terraform.js bucketName()).
  bucket        = "runway-${var.env_name}-${substr(var.env_id, 0, 8)}-ingest"
  force_destroy = true
  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# ── Lambda transformer ──
resource "aws_lambda_function" "transformer" {
  function_name    = "runway-${var.env_name}-transformer"
  role             = aws_iam_role.transformer_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.transformer.output_path
  source_code_hash = data.archive_file.transformer.output_base64sha256

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
      CATALOG_TABLE   = "runway-${var.env_name}-catalog"
      INGEST_BUCKET   = aws_s3_bucket.ingest.bucket
    }
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# ── EventBridge rule firing on new S3 objects ──
resource "aws_cloudwatch_event_rule" "on_object_create" {
  name        = "runway-${var.env_name}-cargo-rule"
  description = "Fire transformer on new objects in the ingest bucket"
  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = { name = [aws_s3_bucket.ingest.bucket] }
    }
  })
}

resource "aws_cloudwatch_event_target" "transformer" {
  rule      = aws_cloudwatch_event_rule.on_object_create.name
  arn       = aws_lambda_function.transformer.arn
  target_id = "runway-${var.env_name}-transformer-target"
}

# ── Catalog table (real-AWS only; local mode pre-creates via terraform.js hook) ──
resource "aws_dynamodb_table" "catalog" {
  count        = var.infra_mode == "local" ? 0 : 1
  name         = "runway-${var.env_name}-catalog"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
}

output "ingest_bucket" {
  value = aws_s3_bucket.ingest.bucket
}
output "catalog_table" {
  value = "runway-${var.env_name}-catalog"
}
output "rule_name" {
  value = aws_cloudwatch_event_rule.on_object_create.name
}
output "env_id" {
  value = var.env_id
}
