aws_region   = "eu-west-3"
name_prefix  = "abstergo-hibernate"

ecs_cluster_name = "abstergo-signaling-cluster"
ecs_service_name = "abstergo-signaling-service"
ecs_desired_count = 1

ec2_instance_id = "i-07babea06c00eeab9"

signaling_health_url        = "http://35.181.228.185/monitoring/cost"
signaling_target_group_name  = "abstergo-signaling-service-tg"
turn_target_group_name       = "abstergo-signaling-service-t3478"

idle_seconds = 3600

common_tags = {
  Project     = "Broken Veil Protocol"
  Environment = "dev"
  ManagedBy   = "opentofu"
  Owner       = "alexandre"
  Stack       = "hibernate-controller"
}
