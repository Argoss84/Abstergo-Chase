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

variable "nlb_name" {
  description = "Network Load Balancer name."
  type        = string
  default     = "abstergo-signaling-nlb"
}

variable "signaling_listener_port" {
  description = "Public listener port exposed by the NLB."
  type        = number
  default     = 80
}

variable "nlb_subnet_id" {
  description = "Single public subnet used by the mono-AZ NLB."
  type        = string
}
