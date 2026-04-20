# TURN voice infrastructure (OpenTofu)

This stack deploys a minimal `coturn` instance on EC2 for voice relay fallback.

## 1) AWS CLI prerequisites

Authenticate first:

```bash
aws login
```

Discover VPC and subnet IDs (same account/region as signaling):

```bash
aws ec2 describe-vpcs --region eu-west-3 --query "Vpcs[?IsDefault==\`true\`].VpcId | [0]" --output text
aws ec2 describe-subnets --region eu-west-3 --filters Name=vpc-id,Values=<VPC_ID> --query "Subnets[0].SubnetId" --output text
```

## 2) Configure variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Then edit:
- `vpc_id`
- `subnet_id`
- `turn_secret` (random long secret)

## 3) Deploy

```bash
tofu init
tofu plan
tofu apply
```

## 4) Client + signaling integration

Use outputs to configure your app/signaling:
- `stun:<ip>:3478`
- `turn:<ip>:3478?transport=udp`
- `turn:<ip>:3478?transport=tcp`

Signaling server should mint temporary TURN credentials with:
- shared secret = `turn_secret`
- short TTL (ex: 10 min)

Recommended signaling env vars:
- `TURN_URLS` (comma separated)
- `TURN_SECRET`
- `TURN_REALM`
- `TURN_TTL_SECONDS`
