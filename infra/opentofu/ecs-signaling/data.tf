data "aws_ecr_repository" "signaling" {
  name = var.ecr_repository_name
}

data "aws_subnet" "first" {
  id = var.subnet_ids[0]
}

data "aws_vpc" "current" {
  id = data.aws_subnet.first.vpc_id
}
