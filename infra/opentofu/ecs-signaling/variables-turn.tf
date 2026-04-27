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

variable "turn_backend_instance_id" {
  description = "Optional TURN EC2 instance ID to route TCP/UDP 3478 through the shared NLB EIP."
  type        = string
  default     = ""
}
