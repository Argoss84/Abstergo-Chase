# OpenTofu hibernate controller

Le NLB et l’EIP restent allumés. Après 1 h sans clients signaling (`/monitoring/cost` : `connectedClients`, `activeLobbies`, `activeGames` à 0), Lambda met ECS à `desired_count = 0` et **stop** le coturn (disque conservé). Un `POST` sur la Function URL réveille les deux avant que Flutter n’ouvre Socket.IO.

La Function URL (`AuthType=NONE`) a **deux** permissions : `lambda:InvokeFunctionUrl` **et** `lambda:InvokeFunction`. Sans la seconde, AWS répond 403 avant le handler.

Le stack `ecs-signaling` doit ignorer le `desired_count` runtime (`lifecycle.ignore_changes`).

## Deploy

```bash
cd infra/opentofu/hibernate-controller
tofu init
tofu plan
tofu apply
tofu output -raw wake_url
tofu output -raw wake_token
```

Copier dans `Flutter/config/cognito.release.json` :

- `SIGNALING_WAKE_URL`
- `SIGNALING_WAKE_TOKEN`

Rebuild avec `--dart-define-from-file=config/cognito.release.json`.

## Client wake

```http
POST <wake_url>
X-Wake-Token: <token>
```

Poll jusqu’à `ready: true` (environ 60–90 s), puis Socket.IO sur `http://35.181.228.185`. En Dev (`10.0.2.2` / localhost), l’app ne réveille pas AWS.

## Forcer l’éveil

```bash
aws dynamodb update-item \
  --table-name abstergo-hibernate-state \
  --key '{"pk":{"S":"stack"}}' \
  --update-expression "SET force_awake = :t" \
  --expression-attribute-values '{":t":{"BOOL":true}}' \
  --region eu-west-3
```
