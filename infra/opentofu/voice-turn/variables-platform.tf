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
