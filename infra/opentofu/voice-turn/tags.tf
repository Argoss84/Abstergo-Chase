resource "aws_ec2_tag" "vpc_name" {
  count       = var.vpc_name_tag != "" ? 1 : 0
  resource_id = var.vpc_id
  key         = "Name"
  value       = var.vpc_name_tag
}
