resource "aws_vpc_security_group_ingress_rule" "task_from_nlb" {
  security_group_id = local.primary_task_security_group_id
  cidr_ipv4         = data.aws_vpc.current.cidr_block
  ip_protocol       = "tcp"
  from_port         = var.container_port
  to_port           = var.container_port
}
