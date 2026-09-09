output "wake_url" {
  description = "HTTPS URL the Flutter app must call before connecting to production signaling."
  value       = aws_lambda_function_url.this.function_url
}

output "wake_token" {
  description = "Shared token sent as X-Wake-Token. Put it in Flutter/config/cognito.release.json."
  value       = local.wake_token
  sensitive   = true
}

output "state_table_name" {
  description = "DynamoDB table that stores hibernation state."
  value       = aws_dynamodb_table.state.name
}

output "lambda_function_name" {
  description = "Hibernate controller Lambda name."
  value       = aws_lambda_function.this.function_name
}
