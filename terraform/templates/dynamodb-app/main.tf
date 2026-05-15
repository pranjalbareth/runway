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
  default = 443
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
  endpoint   = var.infra_mode == "local" ? (
    length(var.mockcloud_endpoint) > 0 ? var.mockcloud_endpoint : "http://localhost:4566"
  ) : null
  table_name = "runway-${var.env_name}"

  # In local mode the table is pre-created by the Runway backend before Terraform runs.
  # The AWS provider calls DescribeTimeToLive / DescribeContinuousBackups on every read,
  # which the local mock does not support, so aws_dynamodb_table is skipped here.
  table_arn  = var.infra_mode == "local" ? "arn:aws:dynamodb:us-east-1:000000000000:table/${local.table_name}" : one(aws_dynamodb_table.main[*].arn)
}

provider "aws" {
  region                      = var.infra_mode == "local" ? "us-east-1" : var.aws_region
  access_key                  = var.infra_mode == "local" ? "mock" : null
  secret_key                  = var.infra_mode == "local" ? "mock" : null
  skip_credentials_validation = var.infra_mode == "local"
  skip_requesting_account_id  = var.infra_mode == "local"
  skip_metadata_api_check     = var.infra_mode == "local"

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content { dynamodb = local.endpoint }
  }
}

# ── AWS mode only: Terraform-managed DynamoDB table ──
# Local mode: table is pre-created by the Runway backend, avoiding
# DescribeTimeToLive / DescribeContinuousBackups calls unsupported by the local mock.

resource "aws_dynamodb_table" "main" {
  count        = var.infra_mode == "local" ? 0 : 1
  name         = local.table_name
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
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  tags = { managed-by = "runway", env-id = var.env_id }
}

output "table_name" { value = local.table_name }
output "table_arn"  { value = local.table_arn }
output "env_id"     { value = var.env_id }
