variable "common_tags" {
  description = "Common tags applied to all taggable AWS resources."
  type        = map(string)
  default = {
    Project   = "abstergo-chase"
    Component = "voice-turn"
    ManagedBy = "opentofu"
  }
}

variable "vpc_name_tag" {
  description = "Optional Name tag to set on the target VPC."
  type        = string
  default     = ""
}
