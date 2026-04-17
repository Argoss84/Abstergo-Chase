# OpenTofu ECS Signaling

This folder contains an OpenTofu configuration to deploy the signaling container to ECS Fargate using an existing ECR repository (`abstergo/signaling` by default).

## Prerequisites

- OpenTofu installed (`tofu --version`)
- AWS CLI authenticated
- Existing VPC subnets and security groups for ECS tasks
- Existing ECR image published by your GitHub Action
- Existing subnet IDs and task security group in the target VPC

## Setup

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Fill `subnet_ids` and `security_group_ids`.
3. Optionally change `image_tag` (for example `sha-<commit>`).
4. Keep `alb_listener_port = 80` unless you need another public port.

## Deploy

```bash
cd infra/opentofu/ecs-signaling
tofu init
tofu plan
tofu apply
```

## Access

After apply, retrieve ALB outputs:

```bash
tofu output alb_dns_name
tofu output socket_base_url
```

Use:
- Server URL: `http://<alb_dns_name>`
- Socket path: `/socket.io`

## Update to a new image

Set a new `image_tag` in `terraform.tfvars`, then:

```bash
tofu plan
tofu apply
```
