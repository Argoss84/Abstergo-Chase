# OpenTofu ECS Signaling

This folder contains an OpenTofu configuration to deploy the signaling container to ECS Fargate behind a mono-AZ Network Load Balancer with a single static Elastic IP.

## Prerequisites

- OpenTofu installed (`tofu --version`)
- AWS CLI authenticated
- Existing VPC subnets and security groups for ECS tasks
- Existing ECR image published by your GitHub Action
- Existing subnet IDs and task security group in the target VPC

## Setup

1. Copy `terraform.tfvars.example` to `terraform.tfvars`.
2. Fill `subnet_ids`, `security_group_ids`, and `nlb_subnet_id`.
3. Optionally change `image_tag` (for example `sha-<commit>`).
4. Keep `signaling_listener_port = 80` unless you need another public port.
5. If you want TURN and signaling on the same public EIP, set `turn_backend_instance_id`.

## Deploy

```bash
cd infra/opentofu/ecs-signaling
tofu init
tofu plan
tofu apply
```

## Access

After apply, retrieve NLB outputs:

```bash
tofu output nlb_dns_name
tofu output public_eip
tofu output socket_base_url
tofu output turn_urls_via_shared_eip
```

Use:
- Server URL: `http://<nlb_dns_name>:<signaling_listener_port>`
- Socket path: `/socket.io`
- Optional TURN URLs via same EIP (when `turn_backend_instance_id` is set): `turn_urls_via_shared_eip`

## Update to a new image

Set a new `image_tag` in `terraform.tfvars`, then:

```bash
tofu plan
tofu apply
```

## Suggested cutover sequence (short downtime)

1. Keep existing ALBs alive while creating the new NLB resources.
2. Apply this stack and verify target group health.
3. Update client signaling endpoint and `TURN_URLS` to the shared EIP.
4. Redeploy ECS task definition/service if env vars changed.
5. Validate signaling + TURN, then delete old ALBs and unused EIPs.
