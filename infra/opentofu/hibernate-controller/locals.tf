data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "random_password" "wake_token" {
  length  = 32
  special = false
}

locals {
  wake_token = var.wake_token != "" ? var.wake_token : random_password.wake_token.result
  ecs_service_arn = format(
    "arn:aws:ecs:%s:%s:service/%s/%s",
    data.aws_region.current.name,
    data.aws_caller_identity.current.account_id,
    var.ecs_cluster_name,
    var.ecs_service_name,
  )
  ec2_instance_arn = format(
    "arn:aws:ec2:%s:%s:instance/%s",
    data.aws_region.current.name,
    data.aws_caller_identity.current.account_id,
    var.ec2_instance_id,
  )
}
