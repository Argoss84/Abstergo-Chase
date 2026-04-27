resource "aws_security_group" "turn" {
  name        = "${var.name_prefix}-sg"
  description = "Security group for coturn server"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "stun_turn_udp_3478" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "udp"
  from_port         = 3478
  to_port           = 3478
  cidr_ipv4         = var.turn_ingress_cidr_ipv4
}

resource "aws_vpc_security_group_ingress_rule" "stun_turn_tcp_3478" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "tcp"
  from_port         = 3478
  to_port           = 3478
  cidr_ipv4         = var.turn_ingress_cidr_ipv4
}

resource "aws_vpc_security_group_ingress_rule" "relay_udp" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "udp"
  from_port         = var.relay_min_port
  to_port           = var.relay_max_port
  cidr_ipv4         = var.turn_ingress_cidr_ipv4
}

resource "aws_vpc_security_group_egress_rule" "all_out" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
