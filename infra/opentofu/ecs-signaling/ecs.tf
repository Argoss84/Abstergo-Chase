resource "aws_ecs_cluster" "this" {
  name = var.ecs_cluster_name
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

  depends_on = [aws_lb_listener.tcp]
}
