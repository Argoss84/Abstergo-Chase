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

data "aws_ami" "ubuntu" {
  owners      = ["099720109477"]
  most_recent = true

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

resource "aws_security_group" "turn" {
  name        = "${var.name_prefix}-sg"
  description = "Security group for coturn server"
  vpc_id      = var.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "ssh" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = var.ssh_ingress_cidr_ipv4
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

resource "aws_vpc_security_group_ingress_rule" "stun_turn_tls_udp_5349" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "udp"
  from_port         = 5349
  to_port           = 5349
  cidr_ipv4         = var.turn_ingress_cidr_ipv4
}

resource "aws_vpc_security_group_ingress_rule" "stun_turn_tls_tcp_5349" {
  security_group_id = aws_security_group.turn.id
  ip_protocol       = "tcp"
  from_port         = 5349
  to_port           = 5349
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

locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
    cat >/etc/turnserver.conf <<CONF
    listening-port=3478
    tls-listening-port=5349
    fingerprint
    use-auth-secret
    static-auth-secret=${var.turn_secret}
    realm=${var.turn_realm}
    total-quota=100
    bps-capacity=0
    stale-nonce=600
    no-loopback-peers
    no-multicast-peers
    min-port=${var.relay_min_port}
    max-port=${var.relay_max_port}
    no-cli
    CONF
    sed -i 's/^#TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
    systemctl enable coturn
    systemctl restart coturn
  EOT
}

resource "aws_instance" "turn" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.turn.id]
  associate_public_ip_address = true
  user_data                   = local.user_data

  tags = {
    Name = "${var.name_prefix}-ec2"
  }
}

resource "aws_eip" "turn" {
  domain = "vpc"
  tags = {
    Name = "${var.name_prefix}-eip"
  }
}

resource "aws_eip_association" "turn" {
  instance_id   = aws_instance.turn.id
  allocation_id = aws_eip.turn.id
}

resource "aws_ec2_tag" "vpc_name" {
  count       = var.vpc_name_tag != "" ? 1 : 0
  resource_id = var.vpc_id
  key         = "Name"
  value       = var.vpc_name_tag
}
