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

output "nlb_dns_name" {
  description = "Public DNS name of the NLB."
  value       = aws_lb.this.dns_name
}

output "public_eip" {
  description = "Public IPv4 address used by the NLB."
  value       = aws_eip.nlb_public.public_ip
}

output "socket_base_url" {
  description = "Base URL to use for signaling server."
  value       = "http://${aws_lb.this.dns_name}:${var.signaling_listener_port}"
}

output "turn_urls_via_shared_eip" {
  description = "TURN URLs to use when turn_backend_instance_id is configured."
  value = var.turn_backend_instance_id != "" ? [
    "stun:${aws_eip.nlb_public.public_ip}:3478",
    "turn:${aws_eip.nlb_public.public_ip}:3478?transport=udp",
    "turn:${aws_eip.nlb_public.public_ip}:3478?transport=tcp"
  ] : []
}
