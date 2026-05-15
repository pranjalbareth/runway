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
  endpoint = var.infra_mode == "local" ? (
    length(var.mockcloud_endpoint) > 0 ? var.mockcloud_endpoint : "http://localhost:4566"
  ) : null

  dlq_name   = "runway-${var.env_name}-dlq"
  queue_name = "runway-${var.env_name}-queue"

  # LocalStack always uses this fixed account ID for local resources
  local_account_id = "000000000000"

  # In local mode queues are pre-created by the Runway backend before Terraform runs.
  # ARNs and URLs follow LocalStack's fixed convention so no SQS API calls are needed here.
  dlq_url   = var.infra_mode == "local" ? "${local.endpoint}/${local.local_account_id}/${local.dlq_name}" : one(aws_sqs_queue.dlq[*].url)
  dlq_arn   = var.infra_mode == "local" ? "arn:aws:sqs:us-east-1:${local.local_account_id}:${local.dlq_name}" : one(aws_sqs_queue.dlq[*].arn)
  queue_url = var.infra_mode == "local" ? "${local.endpoint}/${local.local_account_id}/${local.queue_name}" : one(aws_sqs_queue.main[*].url)
  queue_arn = var.infra_mode == "local" ? "arn:aws:sqs:us-east-1:${local.local_account_id}:${local.queue_name}" : one(aws_sqs_queue.main[*].arn)
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
      lambda = local.endpoint
      iam    = local.endpoint
      sts    = local.endpoint
    }
  }
}

# ── AWS mode only: Terraform-managed SQS queues ──
# Local mode: queues are pre-created by the Runway backend before Terraform runs,
# avoiding the ListQueueTags call that the AWS provider makes on every aws_sqs_queue read.

resource "aws_sqs_queue" "dlq" {
  count                     = var.infra_mode == "local" ? 0 : 1
  name                      = local.dlq_name
  message_retention_seconds = 1209600
  tags                      = { managed-by = "runway", env-id = var.env_id }
}

resource "aws_sqs_queue" "main" {
  count                      = var.infra_mode == "local" ? 0 : 1
  name                       = local.queue_name
  visibility_timeout_seconds = 30
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = local.dlq_arn
    maxReceiveCount     = 3
  })

  tags       = { managed-by = "runway", env-id = var.env_id }
  depends_on = [aws_sqs_queue.dlq]
}

# IAM role for Lambda
resource "aws_iam_role" "worker_role" {
  name = "runway-${var.env_name}-worker-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Lambda worker
resource "aws_lambda_function" "worker" {
  function_name = "runway-${var.env_name}-worker"
  role          = aws_iam_role.worker_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "${path.module}/worker.zip"

  environment {
    variables = {
      QUEUE_URL       = local.queue_url
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
    }
  }

  tags = var.infra_mode == "local" ? {} : { managed-by = "runway", env-id = var.env_id }
}

# SQS trigger for Lambda (AWS mode only — local mock does not support GetEventSourceMapping)
resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  count            = var.infra_mode == "local" ? 0 : 1
  event_source_arn = local.queue_arn
  function_name    = aws_lambda_function.worker.arn
  batch_size       = 10
}

output "queue_url"     { value = local.queue_url }
output "queue_arn"     { value = local.queue_arn }
output "dlq_url"       { value = local.dlq_url }
output "function_name" { value = aws_lambda_function.worker.function_name }
output "env_id"        { value = var.env_id }
