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
