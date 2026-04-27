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
