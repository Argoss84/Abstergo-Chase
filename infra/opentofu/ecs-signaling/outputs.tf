output "ecs_cluster_name" {
  description = "Created ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  description = "Created ECS service name."
  value       = aws_ecs_service.this.name
}

output "task_definition_arn" {
  description = "Task definition ARN."
  value       = aws_ecs_task_definition.this.arn
}

output "deployed_image_uri" {
  description = "Image URI deployed to ECS."
  value       = local.image_uri
}

output "alb_dns_name" {
  description = "Public DNS name of the ALB."
  value       = aws_lb.this.dns_name
}

output "socket_base_url" {
  description = "Base URL to use for signaling server."
  value       = "http://${aws_lb.this.dns_name}"
}
