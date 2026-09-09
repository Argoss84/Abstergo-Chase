# TURN voice infrastructure (OpenTofu)

Instance `coturn` sur EC2 (`t3.micro`), IMDSv2 obligatoire, **sans EIP dédiée**.

En prod, les clients n’utilisent **pas** l’IP publique de cette instance. STUN/TURN passent par l’EIP du NLB signaling (`35.181.228.185:3478`). Cette instance est la cible du target group `abstergo-signaling-service-t3478`.

`hibernate-controller` **stop/start** cette instance. Ne pas la terminer. `lifecycle.ignore_changes` sur AMI / user_data évite un replace après import.

## 1) AWS CLI

```bash
aws login
```

## 2) Variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

`vpc_id` / `subnet_id` doivent être la même AZ que le NLB. `name_prefix` live = `abstergo-turn` (renommer recréerait le SG).

## 3) Deploy

```bash
cd infra/opentofu/voice-turn
tofu init
tofu plan
tofu apply
```

## 4) Intégration

Signaling mint des credentials TURN temporaires :

- `TURN_URLS` = URLs via l’EIP du NLB (stack `ecs-signaling`)
- `TURN_SECRET` / `TURN_REALM` identiques ici et dans `ecs-signaling`
- `TURN_TTL_SECONDS` (ex. 600)

Les outputs `stun_url` / `turn_url_*` de ce stack sont l’IP **éphémère** de l’EC2 (vide si l’instance est stopped). Ne pas les copier dans Flutter.
