aws_region  = "eu-west-3"
name_prefix = "abstergo-turn"

vpc_id    = "vpc-0491c73c129269107"
subnet_id = "subnet-0547ed2467da2d42a"

instance_type          = "t3.micro"
ssh_ingress_cidr_ipv4  = "0.0.0.0/0"
turn_ingress_cidr_ipv4 = "0.0.0.0/0"
turn_realm             = "voice.abstergochase"
relay_min_port         = 49152
relay_max_port         = 49200

turn_secret = "STfSxH3/J1y7JPiivIQWvmzUIkgEb80KksLLj1FvrC+K0lcBqe41uiPJa0c7//vK"
