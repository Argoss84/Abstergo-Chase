locals {
  container_name                 = "abstergo-signaling"
  image_uri                      = "${data.aws_ecr_repository.signaling.repository_url}:${var.image_tag}"
  task_security_group_ids        = (var.task_security_group_id != null && var.task_security_group_id != "") ? [var.task_security_group_id] : var.security_group_ids
  primary_task_security_group_id = (var.task_security_group_id != null && var.task_security_group_id != "") ? var.task_security_group_id : var.security_group_ids[0]
}
