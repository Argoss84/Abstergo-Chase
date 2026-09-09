output "turn_public_ip" {
  description = "Ephemeral public IP of the coturn EC2 (empty when stopped). Clients must use the signaling NLB EIP instead."
  value       = aws_instance.turn.public_ip
}

output "stun_url" {
  description = "STUN URL to configure in clients."
  value       = "stun:${aws_instance.turn.public_ip}:3478"
}

output "turn_url_udp" {
  description = "TURN URL (UDP) to configure in clients."
  value       = "turn:${aws_instance.turn.public_ip}:3478?transport=udp"
}

output "turn_url_tcp" {
  description = "TURN URL (TCP) to configure in clients."
  value       = "turn:${aws_instance.turn.public_ip}:3478?transport=tcp"
}

output "turn_shared_secret" {
  description = "Shared secret used by signaling to mint temporary TURN credentials."
  value       = var.turn_secret
  sensitive   = true
}
