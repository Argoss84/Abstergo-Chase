# infra

Infrastructure as code OpenTofu pour **Abstergo-Chase** (région `eu-west-3`).

## Stacks

| Dossier | Rôle |
|---|---|
| `opentofu/voice-turn/` | EC2 coturn (`t3.micro`) + security group |
| `opentofu/ecs-signaling/` | ECS Fargate signaling derrière le NLB + EIP `35.181.228.185` |
| `opentofu/hibernate-controller/` | Veille 1 h idle / réveil à la demande (Lambda + DynamoDB + EventBridge) |

Hors de ces stacks (existants, ne pas recréer) : Cognito, ECR `abstergo/signaling`, VPC, security group des tâches ECS.

Ne pas gérer Tablea ici.

## Usage

Chaque stack est un projet OpenTofu **séparé**. `tofu init` dans le dossier du stack, pas à la racine du repo.

Ordre si tu appliques les trois : `voice-turn` → `ecs-signaling` → `hibernate-controller`.

```powershell
aws login
cd infra/opentofu/voice-turn
tofu init
tofu plan
tofu apply
```

Répéter dans `ecs-signaling` puis `hibernate-controller`.

Le provider AWS ne lit pas la session `aws login`. Si `tofu` ne trouve pas de credentials, exporter avant :

```powershell
$creds = aws configure export-credentials --format process | ConvertFrom-Json
$env:AWS_ACCESS_KEY_ID     = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
$env:AWS_SESSION_TOKEN      = $creds.SessionToken
$env:AWS_REGION             = "eu-west-3"
```

State local (`terraform.tfstate`), gitignoré.
