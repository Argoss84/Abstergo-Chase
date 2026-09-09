data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/handler.py"
  output_path = "${path.module}/.terraform/hibernate-controller.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name_prefix}-controller"
  retention_in_days = 14
}

resource "aws_lambda_function" "this" {
  function_name    = "${var.name_prefix}-controller"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = var.lambda_timeout_seconds
  memory_size      = 256
  role             = aws_iam_role.lambda.arn

  environment {
    variables = {
      STATE_TABLE                  = aws_dynamodb_table.state.name
      ECS_CLUSTER                  = var.ecs_cluster_name
      ECS_SERVICE                   = var.ecs_service_name
      ECS_DESIRED_COUNT             = tostring(var.ecs_desired_count)
      EC2_INSTANCE_ID               = var.ec2_instance_id
      SIGNALING_HEALTH_URL         = var.signaling_health_url
      SIGNALING_TARGET_GROUP_NAME  = var.signaling_target_group_name
      TURN_TARGET_GROUP_NAME       = var.turn_target_group_name
      IDLE_SECONDS                  = tostring(var.idle_seconds)
      WAKE_TOKEN                    = local.wake_token
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.lambda,
  ]
}

resource "aws_lambda_function_url" "this" {
  function_name      = aws_lambda_function.this.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = ["*"]
    allow_methods = ["*"]
    allow_headers = ["content-type", "x-wake-token", "authorization"]
    max_age       = 86400
  }
}

resource "aws_lambda_permission" "function_url" {
  statement_id           = "FunctionURLAllowPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.this.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

# Required since Oct 2025: Function URLs also need lambda:InvokeFunction or they return 403.
resource "aws_lambda_permission" "function_invoke" {
  statement_id  = "FunctionURLAllowInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "*"
}

resource "aws_cloudwatch_event_rule" "tick" {
  name                = "${var.name_prefix}-tick"
  description         = "Idle check for signaling/TURN hibernation."
  schedule_expression = "rate(5 minutes)"
}

resource "aws_cloudwatch_event_target" "tick" {
  rule  = aws_cloudwatch_event_rule.tick.name
  arn   = aws_lambda_function.this.arn
  input = jsonencode({ hibernate_action = "tick" })
}

resource "aws_lambda_permission" "tick" {
  statement_id  = "AllowEventBridgeTick"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.tick.arn
}
