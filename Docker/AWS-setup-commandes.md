# Commandes AWS (CLI / CloudShell) — mise en place ordonnée

Ce document te demande d’abord les **informations nécessaires**, puis donne une **liste ordonnée** de commandes (style terminal).  
**CloudShell** n’exécute pas Docker : les **build / push** d’images se font sur **ta machine** (ou CodeBuild).

---

## Étape A — Informations à rassembler (remplis avant de lancer)

Réponds mentalement ou sur papier ; tu t’en serviras pour les `export` ci‑dessous.

1. **Région AWS** (ex. `eu-west-3`) : eu-west-3
2. **ID de compte** (12 chiffres) : 812607972480 
   *(Tu peux le laisser vide et utiliser la commande `aws sts get-caller-identity` plus bas.)*
3. **Nom du cluster ECS** (ex. `abstergo-prod`) : abstergo-prod
4. **Préfixe des dépôts ECR** (ex. `abstergo`) : abstergo  
   Les noms complets seront : `<prefix>/signaling`, `<prefix>/monitor`, `<prefix>/application`.
5. **VPC**  
   - Tu utilises le **VPC par défaut** ? (oui / non) : oui 
   - Si non, **ID du VPC** `vpc-...` : ____________________  
   - **Deux sous-réseaux publics** (dans **2 AZ** différentes) pour l’ALB :  
     - `subnet-...` (AZ a) : SUBNET_ID_1="subnet-0547ed2467da2d42a 
     - `subnet-...` (AZ b) : SUBNET_ID_2="subnet-08484844af60e5cda"
6. **Même paire de sous-réseaux** pour les tâches Fargate ? (souvent oui au début) ou des sous-réseaux privés dédiés : précise “Pas encore d’ECS ; au démarrage, même paire de sous-réseaux que l’existant, puis migration vers 2 sous-réseaux privés dédiés.”
7. **Nom de domaine public** (optionnel pour l’instant) :  
   - SPA : ex. `app.example.com` : ____________________  
   - WebSocket : ex. `ws.example.com` : ____________________  
   - API backend (ServerBDD) si utilisée par le navigateur : ex. `https://api.example.com` : ____________________
8. **Certificat ACM** en **même région** que l’ALB (ARN pour HTTPS), si tu termines déjà le TLS sur l’ALB :  
   `arn:aws:acm:...` : ____________________  
   *(Si tu n’as pas encore de certificat, tu peux commencer en HTTP sur le port 80 pour les tests, puis ajouter le listener HTTPS.)*
9. **CIDR autorisé** pour accéder au **monitor** en HTTP/HTTPS (ex. ton IP `/32`, ou `0.0.0.0/0` si tu acceptes le risque) : ____________________
10. **Build de l’image application** — URLs **vues par le navigateur** (après DNS/ALB, ou provisoires) :  
    - `VITE_API_URL` : ____________________  
    - `VITE_SIGNALING_URL` : ____________________  
    *(Souvent `https://…` une fois l’ALB + DNS en place ; sinon URLs temporaires pour test.)*

---

## Étape B — Variables d’environnement (une fois les réponses ci‑dessus connues)

À coller dans **CloudShell** ou ton terminal (bash) après avoir **remplacé** les valeurs d’exemple.

```bash
# --- À adapter ---
export AWS_REGION="eu-west-3"
export AWS_DEFAULT_REGION="$AWS_REGION"
export CLUSTER_NAME="abstergo-prod"
export ECR_PREFIX="abstergo"

# Sous-réseaux (minimum 2 AZ pour l’ALB)
export SUBNET_ID_1="subnet-aaaaaaaaaaaaaaaaa"
export SUBNET_ID_2="subnet-bbbbbbbbbbbbbbbbb"

# VPC (si tu ne prends pas le défaut automatisé plus bas)
export VPC_ID="vpc-ccccccccccccccccc"

# Images (tags poussés sur ECR)
export IMAGE_TAG="latest"

# ARN du rôle d’exécution ECS (souvent créé automatiquement par la console ECS la première fois).
# Récupère-le dans IAM → Roles → ecsTaskExecutionRole, ou laisse vide et utilise la section « IAM » plus bas.
export ECS_EXEC_ROLE_ARN="arn:aws:iam::VOTRE_COMPTE:role/ecsTaskExecutionRole"

# HTTPS (optionnel au début)
export ACM_CERT_ARN="arn:aws:acm:eu-west-3:VOTRE_COMPTE:certificate/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# CIDR pour le trafic entrant vers l’ALB (ex. ton IP /32)
export ALLOW_CIDR="0.0.0.0/0"

# Build Application (machine locale Docker) — URLs navigateur
export VITE_API_URL="https://api.example.com"
export VITE_SIGNALING_URL="https://ws.example.com"
```

**Compte AWS (si tu ne l’as pas noté) :**

```bash
export AWS_ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "$AWS_ACCOUNT_ID"
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
```

**VPC par défaut (si tu as répondu « oui » à la question 5) :**

```bash
export VPC_ID="$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)"
echo "$VPC_ID"
```

**Si tu n’as pas encore les `SUBNET_ID_*`**, liste les sous-réseaux du VPC.

Vérifie d’abord que `VPC_ID` est défini : `echo "$VPC_ID"` (doit afficher `vpc-…`, pas une ligne vide).  
Ensuite utilise **une seule ligne** (évite les `\` en fin de ligne : sous CloudShell / copier-coller, la suite peut être mal interprétée et `--query` se retrouve collé à `--filters`, d’où l’erreur `Expected: '=', received: '-' … --query`).

```bash
aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' --output table
```

Sans variable (exemple en remplaçant par ton VPC) :

```bash
aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-0123456789abcdef0" --query 'Subnets[*].[SubnetId,AvailabilityZone,CidrBlock,MapPublicIpOnLaunch]' --output table
```

Choisis **deux** sous-réseaux en **AZ différentes** (idéalement **publics** pour un ALB *internet-facing*).

---

## Étape C — Liste ordonnée des commandes

### 1) Créer les dépôts ECR

```bash
aws ecr create-repository --repository-name "${ECR_PREFIX}/signaling" --region "$AWS_REGION" || true
aws ecr create-repository --repository-name "${ECR_PREFIX}/monitor" --region "$AWS_REGION" || true
aws ecr create-repository --repository-name "${ECR_PREFIX}/application" --region "$AWS_REGION" || true
```

`|| true` évite l’échec si le dépôt existe déjà.

---

### 2) Groupes de logs CloudWatch (recommandé avant les task definitions)

```bash
aws logs create-log-group --log-group-name /ecs/${ECR_PREFIX}-signaling --region "$AWS_REGION" 2>/dev/null || true
aws logs create-log-group --log-group-name /ecs/${ECR_PREFIX}-monitor --region "$AWS_REGION" 2>/dev/null || true
aws logs create-log-group --log-group-name /ecs/${ECR_PREFIX}-application --region "$AWS_REGION" 2>/dev/null || true
```

---

### 3) Rôle d’exécution des tâches ECS (`ecsTaskExecutionRole`)

Si le rôle **n’existe pas** encore dans ton compte :

```bash
ACCOUNT_ID="$AWS_ACCOUNT_ID"

cat > /tmp/ecs-trust.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ecs-tasks.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role --role-name ecsTaskExecutionRole --assume-role-policy-document file:///tmp/ecs-trust.json 2>/dev/null || true

aws iam attach-role-policy --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy

export ECS_EXEC_ROLE_ARN="$(aws iam get-role --role-name ecsTaskExecutionRole --query 'Role.Arn' --output text)"
echo "$ECS_EXEC_ROLE_ARN"
```

*(Si la création échoue parce que le rôle existe déjà, vérifie seulement l’ARN avec `get-role`.)*

---

### 4) Groupes de sécurité

**4a — SG pour les ALB (HTTP/HTTPS depuis Internet)**

```bash
export SG_ALB=$(aws ec2 create-security-group \
  --group-name ${ECR_PREFIX}-alb-sg \
  --description "ALB abstergo" \
  --vpc-id "$VPC_ID" \
  --query GroupId --output text)

aws ec2 authorize-security-group-ingress --group-id "$SG_ALB" --protocol tcp --port 80 --cidr "$ALLOW_CIDR"
aws ec2 authorize-security-group-ingress --group-id "$SG_ALB" --protocol tcp --port 443 --cidr "$ALLOW_CIDR"
```

**4b — SG pour les tâches**

```bash
export SG_TASKS=$(aws ec2 create-security-group \
  --group-name ${ECR_PREFIX}-tasks-sg \
  --description "Tâches ECS abstergo" \
  --vpc-id "$VPC_ID" \
  --query GroupId --output text)

# Trafic ALB → conteneurs (ports des apps)
aws ec2 authorize-security-group-ingress --group-id "$SG_TASKS" --protocol tcp --port 80 --source-group "$SG_ALB"
aws ec2 authorize-security-group-ingress --group-id "$SG_TASKS" --protocol tcp --port 5174 --source-group "$SG_ALB"
aws ec2 authorize-security-group-ingress --group-id "$SG_TASKS" --protocol tcp --port 8090 --source-group "$SG_ALB"

# Monitor → Signaling (si les deux tâches partagent le même SG_TASKS, le trafic interne entre tâches est autorisé par défaut en sortie ; sinon ajoute une règle explicite depuis SG_TASKS vers SG_TASKS sur 5174)
aws ec2 authorize-security-group-ingress --group-id "$SG_TASKS" --protocol tcp --port 5174 --source-group "$SG_TASKS"
```

*Ajuste si tu sépares un SG par service.*

---

### 5) Target groups (IP — pour Fargate)

```bash
export TG_APP_ARN=$(aws elbv2 create-target-group \
  --name ${ECR_PREFIX}-app-tg \
  --protocol HTTP \
  --port 80 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path / \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

export TG_WS_ARN=$(aws elbv2 create-target-group \
  --name ${ECR_PREFIX}-ws-tg \
  --protocol HTTP \
  --port 5174 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path / \
  --matcher HttpCode=404 \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)

export TG_MON_ARN=$(aws elbv2 create-target-group \
  --name ${ECR_PREFIX}-mon-tg \
  --protocol HTTP \
  --port 8090 \
  --vpc-id "$VPC_ID" \
  --target-type ip \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
```

---

### 6) Créer l’Application Load Balancer

```bash
export ALB_ARN=$(aws elbv2 create-load-balancer \
  --name ${ECR_PREFIX}-alb \
  --subnets "$SUBNET_ID_1" "$SUBNET_ID_2" \
  --security-groups "$SG_ALB" \
  --scheme internet-facing \
  --type application \
  --ip-address-type ipv4 \
  --query 'LoadBalancers[0].LoadBalancerArn' --output text)

export ALB_DNS="$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB_ARN" \
  --query 'LoadBalancers[0].DNSName' --output text)"
echo "DNS ALB = $ALB_DNS"
```

---

### 7) Listeners et règles de routage (un ALB, noms d’hôte différents)

**Création des listeners de base** — d’abord **HTTP 80** (tu pourras supprimer ou rediriger après HTTPS).

```bash
export LISTENER_HTTP_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=fixed-response,FixedResponseConfig='{StatusCode=404,ContentType=text/plain,MessageBody=NotFound}' \
  --query 'Listeners[0].ListenerArn' --output text)
```

**Règles** : remplace les **host patterns** par tes domaines réels (ou pour un test rapide, utilise **une seule** règle avec le `Host` = ton `ALB_DNS` — préfixe avec le pattern `Host` exact si besoin).

Exemple avec trois noms (à adapter ; les trois doivent résoudre vers ce même ALB dans Route 53) :

```bash
# Application (priorité 10)
aws elbv2 create-rule --listener-arn "$LISTENER_HTTP_ARN" --priority 10 \
  --conditions Field=host-header,Values='app.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_APP_ARN"

# WebSocket / signaling (priorité 20)
aws elbv2 create-rule --listener-arn "$LISTENER_HTTP_ARN" --priority 20 \
  --conditions Field=host-header,Values='ws.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_WS_ARN"

# Monitor (priorité 30)
aws elbv2 create-rule --listener-arn "$LISTENER_HTTP_ARN" --priority 30 \
  --conditions Field=host-header,Values='monitor.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_MON_ARN"
```

**Listener HTTPS 443** (si tu as `ACM_CERT_ARN`) :

```bash
export LISTENER_HTTPS_ARN=$(aws elbv2 create-listener \
  --load-balancer-arn "$ALB_ARN" \
  --protocol HTTPS \
  --port 443 \
  --certificates CertificateArn="$ACM_CERT_ARN" \
  --default-actions Type=fixed-response,FixedResponseConfig='{StatusCode=404,ContentType=text/plain,MessageBody=NotFound}' \
  --query 'Listeners[0].ListenerArn' --output text)

# Dupliquer les mêmes règles host-header sur ce listener (priorités 10, 20, 30 identiques)
aws elbv2 create-rule --listener-arn "$LISTENER_HTTPS_ARN" --priority 10 \
  --conditions Field=host-header,Values='app.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_APP_ARN"
aws elbv2 create-rule --listener-arn "$LISTENER_HTTPS_ARN" --priority 20 \
  --conditions Field=host-header,Values='ws.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_WS_ARN"
aws elbv2 create-rule --listener-arn "$LISTENER_HTTPS_ARN" --priority 30 \
  --conditions Field=host-header,Values='monitor.example.com' \
  --actions Type=forward,TargetGroupArn="$TG_MON_ARN"
```

**Provisoire sans DNS** : une règle avec `Field=host-header,Values="$ALB_DNS"` pour tout envoyer vers **app** uniquement, puis tester signaling en ajoutant une règle ou un second ALB — le plus simple reste de créer rapidement trois enregistrements **Route 53** (ALIAS → ALB).

---

### 8) URL publique du signaling (pour `SIGNALING_URL` du monitor)

Une fois HTTPS + DNS en place pour `ws.example.com` :

```bash
export SIGNALING_PUBLIC_URL="https://ws.example.com"
```

*(Si tu n’as que HTTP 80 pour un test : `http://ws.example.com`.)*

---

### 9) Cluster ECS

```bash
aws ecs create-cluster --cluster-name "$CLUSTER_NAME" --region "$AWS_REGION"
```

---

### 10) Enregistrer les task definitions (Fargate)

Remplace dans les blocs ci‑dessous `${ECR_REGISTRY}`, `${IMAGE_TAG}`, `${ECS_EXEC_ROLE_ARN}`, `${AWS_REGION}` en t’assurant que les variables `export` sont bien définies.

**Signaling**

```bash
aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "$(cat <<EOF
{
  "family": "${ECR_PREFIX}-signaling",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "${ECS_EXEC_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "signaling",
      "image": "${ECR_REGISTRY}/${ECR_PREFIX}/signaling:${IMAGE_TAG}",
      "essential": true,
      "portMappings": [{ "containerPort": 5174, "protocol": "tcp" }],
      "environment": [
        { "name": "SIGNALING_PORT", "value": "5174" },
        { "name": "SOCKET_IO_PATH", "value": "/socket.io" },
        { "name": "DISABLE_BDD", "value": "true" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${ECR_PREFIX}-signaling",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
)"
```

**Monitor** (utilise `SIGNALING_PUBLIC_URL` — à définir **après** la connaissance de l’URL réelle)

```bash
export SIGNALING_PUBLIC_URL="https://ws.example.com"

aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "$(cat <<EOF
{
  "family": "${ECR_PREFIX}-monitor",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "${ECS_EXEC_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "monitor",
      "image": "${ECR_REGISTRY}/${ECR_PREFIX}/monitor:${IMAGE_TAG}",
      "essential": true,
      "portMappings": [{ "containerPort": 8090, "protocol": "tcp" }],
      "environment": [
        { "name": "PORT", "value": "8090" },
        { "name": "SIGNALING_URL", "value": "${SIGNALING_PUBLIC_URL}" },
        { "name": "SOCKET_IO_PATH", "value": "/socket.io" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${ECR_PREFIX}-monitor",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
)"
```

**Application**

```bash
aws ecs register-task-definition --region "$AWS_REGION" --cli-input-json "$(cat <<EOF
{
  "family": "${ECR_PREFIX}-application",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "${ECS_EXEC_ROLE_ARN}",
  "containerDefinitions": [
    {
      "name": "application",
      "image": "${ECR_REGISTRY}/${ECR_PREFIX}/application:${IMAGE_TAG}",
      "essential": true,
      "portMappings": [{ "containerPort": 80, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/${ECR_PREFIX}-application",
          "awslogs-region": "${AWS_REGION}",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
EOF
)"
```

---

### 11) Créer les services ECS (avec attachement ALB)

*(Utilise `TG_WS_ARN` pour le signaling — déjà défini plus haut.)*

```bash
# Signaling
aws ecs create-service --cluster "$CLUSTER_NAME" --service-name ${ECR_PREFIX}-signaling \
  --task-definition ${ECR_PREFIX}-signaling \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID_1,$SUBNET_ID_2],securityGroups=[$SG_TASKS],assignPublicIp=ENABLED}" \
  --load-balancers targetGroupArn=$TG_WS_ARN,containerName=signaling,containerPort=5174 \
  --region "$AWS_REGION"

# Application
aws ecs create-service --cluster "$CLUSTER_NAME" --service-name ${ECR_PREFIX}-application \
  --task-definition ${ECR_PREFIX}-application \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID_1,$SUBNET_ID_2],securityGroups=[$SG_TASKS],assignPublicIp=ENABLED}" \
  --load-balancers targetGroupArn=$TG_APP_ARN,containerName=application,containerPort=80 \
  --region "$AWS_REGION"

# Monitor
aws ecs create-service --cluster "$CLUSTER_NAME" --service-name ${ECR_PREFIX}-monitor \
  --task-definition ${ECR_PREFIX}-monitor \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNET_ID_1,$SUBNET_ID_2],securityGroups=[$SG_TASKS],assignPublicIp=ENABLED}" \
  --load-balancers targetGroupArn=$TG_MON_ARN,containerName=monitor,containerPort=8090 \
  --region "$AWS_REGION"
```

`assignPublicIp=ENABLED` simplifie le pull ECR depuis des sous-réseaux publics ; en **réseau privé**, utilise un **NAT Gateway** et mets `DISABLED`.

---

### 12) Build et push des images (**sur ta machine**, pas CloudShell)

À la **racine du dépôt** `Abstergo-Chase-1` :

```bash
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

docker build -f Docker/Dockerfile.signaling -t ${ECR_PREFIX}/signaling:${IMAGE_TAG} .
docker tag ${ECR_PREFIX}/signaling:${IMAGE_TAG} ${ECR_REGISTRY}/${ECR_PREFIX}/signaling:${IMAGE_TAG}
docker push ${ECR_REGISTRY}/${ECR_PREFIX}/signaling:${IMAGE_TAG}

docker build -f Docker/monitor/Dockerfile -t ${ECR_PREFIX}/monitor:${IMAGE_TAG} .
docker tag ${ECR_PREFIX}/monitor:${IMAGE_TAG} ${ECR_REGISTRY}/${ECR_PREFIX}/monitor:${IMAGE_TAG}
docker push ${ECR_REGISTRY}/${ECR_PREFIX}/monitor:${IMAGE_TAG}

docker build -f Docker/Dockerfile.web \
  --build-arg VITE_API_URL="$VITE_API_URL" \
  --build-arg VITE_SIGNALING_URL="$VITE_SIGNALING_URL" \
  -t ${ECR_PREFIX}/application:${IMAGE_TAG} .
docker tag ${ECR_PREFIX}/application:${IMAGE_TAG} ${ECR_REGISTRY}/${ECR_PREFIX}/application:${IMAGE_TAG}
docker push ${ECR_REGISTRY}/${ECR_PREFIX}/application:${IMAGE_TAG}
```

Puis **forcer un nouveau déploiement** pour tirer les images :

```bash
aws ecs update-service --cluster "$CLUSTER_NAME" --service ${ECR_PREFIX}-signaling --force-new-deployment --region "$AWS_REGION"
aws ecs update-service --cluster "$CLUSTER_NAME" --service ${ECR_PREFIX}-monitor --force-new-deployment --region "$AWS_REGION"
aws ecs update-service --cluster "$CLUSTER_NAME" --service ${ECR_PREFIX}-application --force-new-deployment --region "$AWS_REGION"
```

---

## Ordre recommandé en pratique (résumé)

1. Remplir le **questionnaire** + **exports**.  
2. Commandes **1 → 11** (infrastructure + services).  
3. Commandes **12** (build / push) — puis `update-service --force-new-deployment`.  
4. Si l’URL `SIGNALING_URL` ou les `VITE_*` changent : **rebuild** application, **re-enregistrer** la task **monitor** avec la nouvelle env, **déployer**.

---

## Liens utiles

- Guide détaillé interface graphique : [AWS-ECS-Console.md](AWS-ECS-Console.md).

---

## Note sur les fautes dans les commandes `create-service`

Si `aws ecs create-service` échoue avec une erreur de parsing des listes sous Windows PowerShell, exécute ces blocs dans **Git Bash**, **WSL**, ou **CloudShell** (bash). Sous PowerShell, les tableaux `subnets=[...]` peuvent nécessiter des guillemets ou l’échappement adapté.
