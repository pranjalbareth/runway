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

  dynamic "endpoints" {
    for_each = var.infra_mode == "local" ? [1] : []
    content {
      lambda   = local.endpoint
      sqs      = local.endpoint
      iam      = local.endpoint
      dynamodb = local.endpoint
      sts      = local.endpoint
    }
  }
}

data "archive_file" "processor" {
  type        = "zip"
  output_path = "${path.module}/processor.zip"
  source {
    filename = "index.js"
    content  = <<-EOT
      exports.handler = async (event) => {
        const records = (event.Records || []).map(r => ({ id: r.messageId, body: r.body }))
        console.log("Cascade processed", records.length, "messages for ${var.env_name}")
        return { processed: records.length }
      }
    EOT
  }
}

resource "aws_iam_role" "worker_role" {
  name = "runway-${var.env_name}-cascade-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# DLQ + main queue (real-AWS path; local mode pre-creates these via the terraform.js hook)
resource "aws_sqs_queue" "dlq" {
  count                     = var.infra_mode == "local" ? 0 : 1
  name                      = "runway-${var.env_name}-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "inbox" {
  count                      = var.infra_mode == "local" ? 0 : 1
  name                       = "runway-${var.env_name}-queue"
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[0].arn
    maxReceiveCount     = 3
  })
}

resource "aws_lambda_function" "processor" {
  function_name    = "runway-${var.env_name}-processor"
  role             = aws_iam_role.worker_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.processor.output_path
  source_code_hash = data.archive_file.processor.output_base64sha256

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
      RESULTS_TABLE   = "runway-${var.env_name}-results"
    }
  }

  tags = {
    managed-by = "runway"
    env-id     = var.env_id
  }
}

# Real-AWS only: wire SQS → Lambda
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  count            = var.infra_mode == "local" ? 0 : 1
  event_source_arn = aws_sqs_queue.inbox[0].arn
  function_name    = aws_lambda_function.processor.arn
  batch_size       = 5
}

# Real-AWS only: results table (local mode pre-creates this via the terraform.js hook)
resource "aws_dynamodb_table" "results" {
  count        = var.infra_mode == "local" ? 0 : 1
  name         = "runway-${var.env_name}-results"
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

output "queue_name" {
  value = "runway-${var.env_name}-queue"
}
output "dlq_name" {
  value = "runway-${var.env_name}-dlq"
}
output "results_table" {
  value = "runway-${var.env_name}-results"
}
output "env_id" {
  value = var.env_id
}
