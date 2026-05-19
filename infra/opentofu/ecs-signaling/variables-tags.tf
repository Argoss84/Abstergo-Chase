variable "common_tags" {
  description = "Common tags applied to all taggable AWS resources."
  type        = map(string)
  default = {
    Project   = "Broken Veil Protocol"
    Component = "signaling"
    ManagedBy = "opentofu"
  }
}

variable "vpc_name_tag" {
  description = "Optional Name tag to set on the VPC inferred from subnet_ids."
  type        = string
  default     = ""
}
