variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "eu-west-3"
}

variable "ecr_repository_name" {
  description = "Existing ECR repository name."
  type        = string
  default     = "abstergo/signaling"
}

variable "image_tag" {
  description = "ECR image tag to deploy (latest, sha-<commit>, etc)."
  type        = string
  default     = "latest"
}

variable "ecs_cluster_name" {
  description = "ECS cluster name."
  type        = string
  default     = "abstergo-signaling-cluster"
}

variable "ecs_service_name" {
  description = "ECS service name."
  type        = string
  default     = "abstergo-signaling-service"
}

variable "task_definition_family" {
  description = "Task definition family."
  type        = string
  default     = "abstergo-signaling-task"
}

variable "task_cpu" {
  description = "Fargate CPU units."
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Fargate memory in MiB."
  type        = number
  default     = 512
}

variable "container_port" {
  description = "Port exposed by signaling container."
  type        = number
  default     = 5174
}

variable "socket_io_path" {
  description = "Socket.IO path used by signaling server."
  type        = string
  default     = "/socket.io"
}

variable "memory_only_mode" {
  description = "Run signaling in memory-only mode."
  type        = bool
  default     = true
}

variable "empty_game_ttl_ms" {
  description = "TTL for empty games in milliseconds."
  type        = number
  default     = 300000
}

variable "desired_count" {
  description = "Number of ECS tasks."
  type        = number
  default     = 1
}

variable "subnet_ids" {
  description = "Subnets where ECS tasks run."
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups attached to ECS tasks."
  type        = list(string)
}

variable "task_security_group_id" {
  description = "Optional single task security group ID used instead of security_group_ids."
  type        = string
  default     = null
}

variable "assign_public_ip" {
  description = "Assign public IP to task ENI."
  type        = bool
  default     = true
}

variable "alb_name" {
  description = "Application Load Balancer name."
  type        = string
  default     = "abstergo-signaling-alb"
}

variable "alb_listener_port" {
  description = "ALB listener port."
  type        = number
  default     = 80
}

variable "alb_ingress_cidr_ipv4" {
  description = "CIDR allowed to access ALB listener."
  type        = string
  default     = "0.0.0.0/0"
}

variable "turn_urls" {
  description = "Comma separated list of STUN/TURN URLs used by clients."
  type        = string
  default     = ""
}

variable "turn_secret" {
  description = "TURN shared secret for temporary credentials."
  type        = string
  default     = ""
  sensitive   = true
}

variable "turn_realm" {
  description = "TURN realm used by signaling and coturn."
  type        = string
  default     = ""
}

variable "turn_ttl_seconds" {
  description = "TTL in seconds for generated TURN credentials."
  type        = number
  default     = 600
}

variable "common_tags" {
  description = "Common tags applied to all taggable AWS resources."
  type        = map(string)
  default = {
    Project   = "abstergo-chase"
    Component = "signaling"
    ManagedBy = "opentofu"
  }
}

variable "vpc_name_tag" {
  description = "Optional Name tag to set on the VPC inferred from subnet_ids."
  type        = string
  default     = ""
}

variable "network_name_prefix" {
  description = "Prefix used for Name tags on shared network resources."
  type        = string
  default     = "abstergo-shared"
}
