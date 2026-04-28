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
