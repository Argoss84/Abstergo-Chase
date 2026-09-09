resource "aws_instance" "turn" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  vpc_security_group_ids      = [aws_security_group.turn.id]
  associate_public_ip_address = true
  user_data                   = local.user_data
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  lifecycle {
    # Live instance was imported; AMI / public IP drift must not recreate coturn.
    ignore_changes = [
      ami,
      associate_public_ip_address,
      user_data,
      user_data_base64,
    ]
  }

  tags = {
    Name = "${var.name_prefix}-ec2"
  }
}
