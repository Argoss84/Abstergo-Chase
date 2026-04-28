resource "aws_eip" "nlb_public" {
  domain = "vpc"
  tags = {
    Name = "${var.ecs_service_name}-nlb-eip"
  }
}

resource "aws_lb" "this" {
  name                             = var.nlb_name
  internal                         = false
  load_balancer_type               = "network"
  enable_cross_zone_load_balancing = true

  subnet_mapping {
    subnet_id     = var.nlb_subnet_id
    allocation_id = aws_eip.nlb_public.id
  }
}

resource "aws_lb_target_group" "this" {
  name        = "${var.ecs_service_name}-tg"
  port        = var.container_port
  protocol    = "TCP"
  target_type = "ip"
  vpc_id      = data.aws_subnet.first.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    protocol            = "HTTP"
    path                = "/"
    matcher             = "200-499"
    timeout             = 6
  }
}

resource "aws_lb_listener" "tcp" {
  load_balancer_arn = aws_lb.this.arn
  port              = var.signaling_listener_port
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}

resource "aws_lb_target_group" "turn_tcp_udp" {
  count       = var.turn_backend_instance_id != "" ? 1 : 0
  name        = substr("${var.ecs_service_name}-t3478", 0, 32)
  port        = 3478
  protocol    = "TCP_UDP"
  target_type = "instance"
  vpc_id      = data.aws_subnet.first.vpc_id

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    protocol            = "TCP"
    timeout             = 10
  }
}

resource "aws_lb_target_group_attachment" "turn_instance" {
  count            = var.turn_backend_instance_id != "" ? 1 : 0
  target_group_arn = aws_lb_target_group.turn_tcp_udp[0].arn
  target_id        = var.turn_backend_instance_id
  port             = 3478
}

resource "aws_lb_listener" "turn_tcp_udp" {
  count             = var.turn_backend_instance_id != "" ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 3478
  protocol          = "TCP_UDP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.turn_tcp_udp[0].arn
  }
}
