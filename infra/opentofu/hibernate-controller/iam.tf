data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "lambda_runtime" {
  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid = "State"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.state.arn]
  }

  statement {
    sid = "EcsDescribe"
    actions = [
      "ecs:DescribeServices",
    ]
    resources = ["*"]
  }

  statement {
    sid = "EcsUpdate"
    actions = [
      "ecs:UpdateService",
    ]
    resources = [local.ecs_service_arn]
  }

  statement {
    sid = "Ec2Mutate"
    actions = [
      "ec2:StartInstances",
      "ec2:StopInstances",
    ]
    resources = [local.ec2_instance_arn]
  }

  statement {
    sid = "Ec2Describe"
    actions = [
      "ec2:DescribeInstances",
    ]
    resources = ["*"]
  }

  statement {
    sid = "ElbDescribe"
    actions = [
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.name_prefix}-runtime"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_runtime.json
}
