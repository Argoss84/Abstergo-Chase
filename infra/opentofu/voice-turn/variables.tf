variable "aws_region" {
  description = "AWS region for TURN infrastructure."
  type        = string
  default     = "eu-west-3"
}

variable "name_prefix" {
  description = "Prefix used for created resources."
  type        = string
  default     = "abstergo-turn"
}

variable "subnet_id" {
  description = "Public subnet ID where the TURN instance runs."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID used by TURN security group."
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type for coturn."
  type        = string
  default     = "t3.micro"
}

variable "ssh_ingress_cidr_ipv4" {
  description = "CIDR allowed for SSH access."
  type        = string
  default     = "0.0.0.0/0"
}

variable "turn_ingress_cidr_ipv4" {
  description = "CIDR allowed for TURN/STUN access."
  type        = string
  default     = "0.0.0.0/0"
}

variable "turn_secret" {
  description = "Shared secret for TURN REST API auth."
  type        = string
  sensitive   = true
}

variable "turn_realm" {
  description = "TURN realm used by coturn."
  type        = string
  default     = "voice.abstergochase"
}

variable "relay_min_port" {
  description = "Minimum UDP relay port."
  type        = number
  default     = 49152
}

variable "relay_max_port" {
  description = "Maximum UDP relay port."
  type        = number
  default     = 49200
}
