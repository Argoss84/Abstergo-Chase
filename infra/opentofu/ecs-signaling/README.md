# OpenTofu ECS Signaling

Déploie le conteneur de signalisation sur ECS Fargate derrière un NLB **mono-AZ** avec une EIP statique (`35.181.228.185`). Le coturn (`turn_backend_instance_id`) est exposé sur le **même** EIP en TCP/UDP 3478.

Le `desired_count` runtime est géré par `hibernate-controller` (`lifecycle.ignore_changes`).

## Prérequis

- OpenTofu (`tofu --version`)
- AWS CLI authentifié (`aws login`, région `eu-west-3`)
- Image ECR `abstergo/signaling:latest`
- VPC / subnet / SG des tâches déjà existants

## Setup

1. Copier `terraform.tfvars.example` vers `terraform.tfvars` si besoin.
2. `nlb_subnet_id` et `subnet_ids` doivent être **la même AZ** (NLB mono-AZ).
3. Garder `signaling_listener_port = 80`.
4. `turn_backend_instance_id` = instance coturn du stack `voice-turn`.

L’instance coturn est déjà enregistrée sur le target group 3478. Ce n’est pas une ressource OpenTofu (le provider AWS 5.x ne l’importe pas). Si le target group est recréé :

```bash
aws elbv2 register-targets --target-group-arn <arn> --targets Id=<instance-id>,Port=3478
```

## Deploy

```bash
cd infra/opentofu/ecs-signaling
tofu init
tofu plan
tofu apply
```

## Outputs

```bash
tofu output public_eip
tofu output socket_base_url
tofu output turn_urls_via_shared_eip
```

Côté app : `http://<eip>` (port 80) et `TURN_URLS` via la même EIP, pas l’IP publique de l’EC2.

## Nouvelle image

Changer `image_tag` dans `terraform.tfvars`, puis `tofu apply`.
