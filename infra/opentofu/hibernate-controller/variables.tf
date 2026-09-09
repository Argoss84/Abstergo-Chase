variable "aws_region" {
  description = "AWS region."
  type        = string
  default     = "eu-west-3"
}

variable "name_prefix" {
  description = "Prefix used for created resources."
  type        = string
  default     = "abstergo-hibernate"
}

variable "ecs_cluster_name" {
  description = "Existing ECS cluster that hosts signaling."
  type        = string
}

variable "ecs_service_name" {
  description = "Existing ECS signaling service name."
  type        = string
}

variable "ecs_desired_count" {
  description = "Desired ECS task count when the stack is awake."
  type        = number
  default     = 1
}

variable "ec2_instance_id" {
  description = "coturn EC2 instance ID to start/stop."
  type        = string
}

variable "signaling_health_url" {
  description = "Public HTTP URL used to detect signaling readiness and idle clients."
  type        = string
}

variable "signaling_target_group_name" {
  description = "NLB target group name for signaling."
  type        = string
}

variable "turn_target_group_name" {
  description = "NLB target group name for TURN. Empty to skip TURN health."
  type        = string
  default     = ""
}

variable "idle_seconds" {
  description = "Idle time before sleeping compute."
  type        = number
  default     = 3600
}

variable "wake_token" {
  description = "Shared token required on the wake Function URL. Generated if empty."
  type        = string
  default     = ""
  sensitive   = true
}

variable "lambda_timeout_seconds" {
  description = "Lambda timeout."
  type        = number
  default     = 30
}

variable "common_tags" {
  description = "Common tags applied to all taggable AWS resources."
  type        = map(string)
  default = {
    Project     = "Broken Veil Protocol"
    Environment = "dev"
    ManagedBy   = "opentofu"
    Stack       = "hibernate-controller"
  }
}
