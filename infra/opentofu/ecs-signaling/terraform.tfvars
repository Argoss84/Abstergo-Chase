aws_region          = "eu-west-3"
ecr_repository_name = "abstergo/signaling"
image_tag           = "latest"

ecs_cluster_name       = "abstergo-signaling-cluster"
ecs_service_name       = "abstergo-signaling-service"
task_definition_family = "abstergo-signaling-task"

task_cpu               = 256
task_memory            = 512
container_port         = 5174
socket_io_path         = "/socket.io"
memory_only_mode       = true
empty_game_ttl_ms      = 300000
desired_count          = 1
assign_public_ip       = true
task_security_group_id = "sg-01b999f1951fb5bc3"

alb_name              = "abstergo-signaling-alb"
alb_listener_port     = 80
alb_ingress_cidr_ipv4 = "0.0.0.0/0"

# Auto-populated from AWS CLI (default VPC in eu-west-3).
subnet_ids = [
  "subnet-0547ed2467da2d42a",
  "subnet-08484844af60e5cda",
  "subnet-0f11c3bc8d02082f3"
]

security_group_ids = [
  "sg-01b999f1951fb5bc3"
]
