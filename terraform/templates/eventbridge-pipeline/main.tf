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
      cloudwatchevents = local.endpoint
      cloudwatchlogs   = local.endpoint
      lambda           = local.endpoint
      iam              = local.endpoint
      sts              = local.endpoint
    }
  }
}

# IAM role for Lambda
resource "aws_iam_role" "pipeline_role" {
  name = "runway-${var.env_name}-pipeline-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

# Lambda processor
resource "aws_lambda_function" "processor" {
  function_name = "runway-${var.env_name}-processor"
  role          = aws_iam_role.pipeline_role.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = "${path.module}/processor.zip"

  environment {
    variables = {
      RUNWAY_ENV_NAME = var.env_name
      RUNWAY_ENV_ID   = var.env_id
    }
  }

  tags = var.infra_mode == "local" ? {} : { managed-by = "runway", env-id = var.env_id }
}

# CloudWatch log group for Lambda
# Local mode: skip — CloudWatch Logs API is not needed for the local mock
resource "aws_cloudwatch_log_group" "processor_logs" {
  count             = var.infra_mode == "local" ? 0 : 1
  name              = "/aws/lambda/runway-${var.env_name}-processor"
  retention_in_days = 7

  tags = { managed-by = "runway", env-id = var.env_id }
}

# EventBridge rule — fires every minute (cron pattern for demo)
resource "aws_cloudwatch_event_rule" "pipeline_rule" {
  name                = "runway-${var.env_name}-rule"
  description         = "Runway ${var.env_name} EventBridge pipeline"
  schedule_expression = "rate(1 minute)"

  tags = var.infra_mode == "local" ? {} : { managed-by = "runway", env-id = var.env_id }
}

# EventBridge target → Lambda
resource "aws_cloudwatch_event_target" "lambda_target" {
  rule      = aws_cloudwatch_event_rule.pipeline_rule.name
  target_id = "runway-${var.env_name}-lambda"
  arn       = aws_lambda_function.processor.arn
}

# Permission for EventBridge to invoke Lambda
# Local mode: skip — local mock does not support AddPermission (POST .../policy)
resource "aws_lambda_permission" "allow_eventbridge" {
  count         = var.infra_mode == "local" ? 0 : 1
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.processor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.pipeline_rule.arn
}

output "rule_name"     { value = aws_cloudwatch_event_rule.pipeline_rule.name }
output "function_name" { value = aws_lambda_function.processor.function_name }
output "log_group"     { value = var.infra_mode == "local" ? "/aws/lambda/runway-${var.env_name}-processor" : aws_cloudwatch_log_group.processor_logs[0].name }
output "env_id"        { value = var.env_id }
