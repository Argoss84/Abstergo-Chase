terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = var.common_tags
  }
}

locals {
  container_name                 = "abstergo-signaling"
  image_uri                      = "${data.aws_ecr_repository.signaling.repository_url}:${var.image_tag}"
  task_security_group_ids        = (var.task_security_group_id != null && var.task_security_group_id != "") ? [var.task_security_group_id] : var.security_group_ids
  primary_task_security_group_id = (var.task_security_group_id != null && var.task_security_group_id != "") ? var.task_security_group_id : var.security_group_ids[0]
}

data "aws_ecr_repository" "signaling" {
  name = var.ecr_repository_name
}

data "aws_subnet" "first" {
  id = var.subnet_ids[0]
}

data "aws_internet_gateway" "vpc" {
  filter {
    name   = "attachment.vpc-id"
    values = [data.aws_subnet.first.vpc_id]
  }
}

data "aws_route_tables" "vpc" {
  vpc_id = data.aws_subnet.first.vpc_id
}

data "aws_network_acls" "vpc" {
  vpc_id = data.aws_subnet.first.vpc_id
}

resource "aws_ecs_cluster" "this" {
  name = var.ecs_cluster_name
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution_role" {
  name               = "${var.ecs_service_name}-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution_role_policy" {
  role       = aws_iam_role.task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "this" {
  family                   = var.task_definition_family
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.task_execution_role.arn

  container_definitions = jsonencode([
    {
      name      = local.container_name
      image     = local.image_uri
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        { name = "SIGNALING_PORT", value = tostring(var.container_port) },
        { name = "SOCKET_IO_PATH", value = var.socket_io_path },
        { name = "MEMORY_ONLY_MODE", value = tostring(var.memory_only_mode) },
        { name = "EMPTY_GAME_TTL_MS", value = tostring(var.empty_game_ttl_ms) },
        { name = "TURN_URLS", value = var.turn_urls },
        { name = "TURN_SECRET", value = var.turn_secret },
        { name = "TURN_REALM", value = var.turn_realm },
        { name = "TURN_TTL_SECONDS", value = tostring(var.turn_ttl_seconds) }
      ]
    }
  ])
}

resource "aws_security_group" "alb" {
  name        = "${var.ecs_service_name}-alb-sg"
  description = "ALB security group for signaling service"
  vpc_id      = data.aws_subnet.first.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_in" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "tcp"
  from_port         = var.alb_listener_port
  to_port           = var.alb_listener_port
  cidr_ipv4         = var.alb_ingress_cidr_ipv4
}

resource "aws_vpc_security_group_egress_rule" "alb_all_out" {
  security_group_id = aws_security_group.alb.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = local.primary_task_security_group_id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
}

resource "aws_lb" "this" {
  name               = var.alb_name
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids
}

resource "aws_lb_target_group" "this" {
  name        = "${var.ecs_service_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = data.aws_subnet.first.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    path                = "/"
    matcher             = "200-499"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = var.alb_listener_port
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_ecs_service" "this" {
  name            = var.ecs_service_name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = local.task_security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = local.container_name
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  depends_on = [aws_lb_listener.http]
}

resource "aws_ec2_tag" "vpc_name" {
  count       = var.vpc_name_tag != "" ? 1 : 0
  resource_id = data.aws_subnet.first.vpc_id
  key         = "Name"
  value       = var.vpc_name_tag
}

resource "aws_ec2_tag" "subnet_name" {
  for_each = {
    for idx, subnet_id in var.subnet_ids :
    subnet_id => idx + 1
  }
  resource_id = each.key
  key         = "Name"
  value       = "${var.network_name_prefix}-subnet-${each.value}"
}

resource "aws_ec2_tag" "route_table_name" {
  for_each = toset(data.aws_route_tables.vpc.ids)
  resource_id = each.value
  key         = "Name"
  value       = "${var.network_name_prefix}-rtb-${replace(each.value, "rtb-", "")}"
}

resource "aws_ec2_tag" "internet_gateway_name" {
  resource_id = data.aws_internet_gateway.vpc.id
  key         = "Name"
  value       = "${var.network_name_prefix}-igw"
}

resource "aws_ec2_tag" "network_acl_name" {
  for_each = toset(data.aws_network_acls.vpc.ids)
  resource_id = each.value
  key         = "Name"
  value       = "${var.network_name_prefix}-nacl-${replace(each.value, "acl-", "")}"
}
