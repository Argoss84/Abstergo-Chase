# Déployer signaling, monitor et application sur AWS (console ECR + ECS)

Pour la même stack en **commandes CLI ordonnées** (questionnaire + exports + bash), voir [AWS-setup-commandes.md](AWS-setup-commandes.md).

Ce guide décrit le parcours **depuis la console AWS** : création des dépôts **ECR**, préparation des images, création d’un cluster **ECS (Fargate)**, des **task definitions**, des **services**, du réseau et des équilibreurs de charge pour que le tout fonctionne ensemble.

**Hypothèses :**

- Région AWS fixée une fois pour toute (ex. `eu-west-3`).
- Même **VPC** et sous-réseaux pour les trois services (souvent les sous-réseaux **publics** si tu places les tâches derrière un **ALB** ; ou privés + ALB en public selon ton modèle).
- Images construites comme dans le dépôt :  
  `Docker/Dockerfile.signaling`, `Docker/monitor/Dockerfile`, `Docker/Dockerfile.web` (contexte de build = **racine du dépôt**).

**Ports conteneur :**

| Service       | Port conteneur |
|---------------|----------------|
| signaling     | **5174**       |
| monitor       | **8090**       |
| application   | **80**         |

---

## 1. Vue d’ensemble réseau

- **Application (SPA)** : les joueurs y ouvrent le site via **HTTPS** (ex. `https://app.example.com`) → **Application Load Balancer ()** → cible sur le port **80** du conteneur.
- **Signaling (Socket.IO)** : le navigateur ouvre une connexion **WebSocket** vers une URL publique (ex. `https://ws.example.com`) → **ALB** (compatible upgrade WebSocket) → port **5174** du conteneur.
- **Monitor** : idéalement **non exposé sur Internet sans protection** (VPN, bastion, ou règle ALB + auth). Techniquement : ALB (optionnel) → port **8090** du conteneur.

Le **monitor** doit joindre le **signaling** avec la variable `SIGNALING_URL`. En production, tu peux utiliser :

- l’**URL publique** du signaling (simple, le trafic repasse par l’ALB), ou  
- le **nom DNS interne** du service signaling si tu utilises **Service Discovery (Cloud Map)** (recommandé pour le trafic VPC–VPC).

L’**application** embarque au **build** les URLs `VITE_API_URL` et `VITE_SIGNALING_URL` vues par le **navigateur** (pas l’URL interne ECS). Il faut donc **reconstruire l’image** application quand ces URLs changent.

---

## 2. Prérequis côté AWS et local

1. Compte AWS, droits pour **ECR**, **ECS**, **VPC**, **EC2 (ALB)**, **IAM**, éventuellement **Route 53** et **ACM** (certificats TLS).
2. **Docker** installé en local (pour construire et pousser les images vers ECR).
3. **AWS CLI v2** installé et configuré (`aws configure`) pour les commandes `docker login` / `push`.

Tu noteras :

- **Account ID** : chiffre à 12 dígits (AWS Console → compte en haut à droite).
- **Région** : ex. `eu-west-3`.

---

## 3. Créer les dépôts ECR (console)

1. Console AWS → **Amazon ECR** → **Repositories** → **Create repository**.
2. Crée **trois** dépôts (visibilité **Private**), par exemple :
   - `abstergo/signaling`
   - `abstergo/monitor`
   - `abstergo/application`
3. Pour chaque dépôt, note **l’URI** affiché, du type :  
   `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/abstergo/signaling`

Répète pour les trois noms.
---
812607972480.dkr.ecr.eu-west-3.amazonaws.com/abstergo/application
812607972480.dkr.ecr.eu-west-3.amazonaws.com/abstergo/monitor
812607972480.dkr.ecr.eu-west-3.amazonaws.com/abstergo/signaling
---

## 4. Construire et pousser les images (machine locale + CLI)

La console ECR **ne build pas** ton code depuis ton PC : tu construis en local (ou dans CodeBuild), puis tu **push**.

### 4.1 Connexion Docker à ECR

```bash
aws ecr get-login-password --region <REGION> | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com
```

### 4.2 Depuis la racine du dépôt Git (Abstergo-Chase-1)

Remplace `<ECR_PREFIX>` par `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com`.

**Signaling**

```bash
docker build -f Docker/Dockerfile.signaling -t abstergo/signaling:latest .
docker tag abstergo/signaling:latest <ECR_PREFIX>/abstergo/signaling:latest
docker push <ECR_PREFIX>/abstergo/signaling:latest
```

**Monitor**  
(Le conteneur utilisera `SIGNALING_URL` **au runtime** sur ECS ; pour le test local tu peux passer une URL fictive, l’image reste la même.)

```bash
docker build -f Docker/monitor/Dockerfile -t abstergo/monitor:latest .
docker tag abstergo/monitor:latest <ECR_PREFIX>/abstergo/monitor:latest
docker push <ECR_PREFIX>/abstergo/monitor:latest
```

**Application**  
Ici tu dois fixer les URLs **vues par le navigateur** (HTTPS conseillé une fois l’ALB en place) :

```bash
docker build -f Docker/Dockerfile.web \
  --build-arg VITE_API_URL=https://api.example.com \
  --build-arg VITE_SIGNALING_URL=https://ws.example.com \
  -t abstergo/application:latest .
docker tag abstergo/application:latest <ECR_PREFIX>/abstergo/application:latest
docker push <ECR_PREFIX>/abstergo/application:latest
```

Adapte `api.example.com` / `ws.example.com` (et éventuellement `VITE_TURN_*`) à ton DNS réel.

### 4.3 Vérification dans la console

**ECR** → chaque dépôt → onglet **Images** : tu dois voir le tag `latest` (ou celui que tu as poussé).

---

## 5. Groupes de sécurité (console EC2 → Security Groups)

Crée au minimum :

1. **SG-ALB**  
   - **Inbound** : `443` (HTTPS) depuis `0.0.0.0/0` (ou IP restreintes pour le monitor).  
   - **Outbound** : tout le trafic vers les SG des tâches (ou vers le VPC).

2. **SG-TASKS-SIGNLING**  
   - **Inbound** : port **5174** TCP **depuis** le SG de l’ALB qui dessert le signaling (et depuis le SG du **monitor** si tu utilises des IP internes).  
   - **Outbound** : selon besoin (Internet pour Appel API BDD, ou vers ton RDS/VPC).

3. **SG-TASKS-MONITOR**  
   - **Inbound** : **8090** depuis le SG de l’ALB du monitor (ou depuis ton VPN/bastion).  
   - **Outbound** : autoriser le **5174** vers le SG du signaling (ou vers l’ALB du signaling selon `SIGNALING_URL`).

4. **SG-TASKS-APP**  
   - **Inbound** : **80** depuis le SG de l’ALB frontal application.  
   - **Outbound** : selon besoin.

Ajuste si tu mets tout derrière un seul ALB avec des **règles d’écoute** par nom d’hôte.

---

## 6. Créer le cluster ECS (console)

1. **Amazon ECS** → **Clusters** → **Create cluster**.
2. Nom ex. `abstergo-production`.
3. Infrastructure : **AWS Fargate (serverless)** (recommandé pour démarrer).
4. Création du cluster (pas besoin de créer un VPC si tu réutilises le VPC par défaut, mais vérifie les sous-réseaux pour les services + ALB).

---

## 7. Task definitions (console)

Pour **chaque** service : **Task definitions** → **Create new task definition** → **Fargate**.

### Réglages communs

- **Task CPU / memory** : ex. 0.25 vCPU / 512 MiB pour signaling et monitor ; 0.25–0.5 vCPU pour l’application selon charge.
- **Task role** : optionnel au début (si pas d’accès S3/SSM).  
- **Task execution role** : **ecsTaskExecutionRole** (créé automatiquement si tu coches la création ; il doit pouvoir **pull ECR** et écrire les logs **CloudWatch**).

### 7.1 Task definition : `signaling`

- **Container name** : `signaling`
- **Image URI** : l’URI ECR `.../abstergo/signaling:latest`
- **Port mappings** : **5174** / TCP
- **Variables d’environnement** (exemples) :
  - `SIGNALING_PORT` = `5174`
  - `SOCKET_IO_PATH` = `/socket.io`
  - `DISABLE_BDD` = `true` *(ou `false` + `BDD_URL` vers ton API si tu la déploies)*

**Logging** : activer le driver **awslogs** (création automatique du groupe de logs).

### 7.2 Task definition : `monitor`

- **Container** : `monitor`
- **Image** : `.../abstergo/monitor:latest`
- **Port** : **8090**
- **Variables d’environnement** :
  - `PORT` = `8090`
  - `SIGNALING_URL` = URL atteignable **depuis cette tâche** vers le signaling, par ex. :
    - `http://signaling.<namespace>:5174` si tu configures **Service Discovery** (voir section 9), ou  
    - `https://ws.example.com` (même URL publique que le navigateur, en **HTTPS** si l’ALB termine TLS — dans ce cas l’URL doit correspondre au schéma réel).
  - `SOCKET_IO_PATH` = `/socket.io`

### 7.3 Task definition : `application`

- **Container** : `application`
- **Image** : `.../abstergo/application:latest`
- **Port** : **80**
- Pas de `VIO_*` au runtime : déjà dans l’image ; pour changer les URLs du front, **rebuild + nouveau push + nouveau déploiement** avec une nouvelle révision de task definition pointant le nouveau digest/tag.

Enregistre chaque task definition (tu obtiens une **révision**, ex. `abstergo-signaling:1`).

---

## 8. Application Load Balancer (ALB)

Tu peux utiliser **un** ou **plusieurs** ALB. Exemple simple : **deux** ALB — un pour le **front**, un pour le **WebSocket** (séparation claire des certificats et des cibles).

### 8.1 ALB pour l’application (HTTPS → port 80 des tâches)

1. **EC2** → **Load Balancers** → **Create** → **Application Load Balancer**.
2. **Scheme** : Internet-facing (souvent).
3. **Listeners** : **HTTPS:443** (ajoute un certificat **ACM** dans la même région) ; si besoin, redirect HTTP→HTTPS sur un second listener.
4. **Target group** : type **IP** (Fargate), **VPC** identique, **Protocol HTTP**, **Port 80**, **Health check path** `/` ou `/index.html`, code succès **200**.
5. Crée l’ALB dans des sous-réseaux **publics** ; attache **SG-ALB**.

### 8.2 ALB pour le signaling (HTTPS → port 5174)

1. Nouvel ALB (ou listener + règle sur le même ALB avec **host** `ws.example.com`).
2. **Target group** : **IP**, port **5174**, protocole **HTTP** (le ALB parle HTTP aux cibles même si le client est en HTTPS).
3. **Health check** :  
   - Chemin `/` — sur ton serveur, la racine renvoie **404**. Dans la console du target group → **Health checks** → **Advanced** → **Success codes** : indique par ex. **`404`** (ou la plage que tu acceptes), **ou** utilise un health check **TCP** sur 5174 si tu préfères ne pas dépendre du code HTTP.

Enregistre l’**DNS name** de l’ALB (ex. `abstergo-ws-123456789.eu-west-3.elb.amazonaws.com`) pour `VITE_SIGNALING_URL` et pour `SIGNALING_URL` du monitor si tu passes par le même point d’entrée.

### 8.3 Monitor (optionnel, à sécuriser)

Même principe : target group port **8090**, listener HTTPS si exposition publique ; restreindre par **IP** ou mettre l’ALB en **internal** + VPN.

---

## 9. Service Discovery (optionnel mais utile)

Pour que **monitor → signaling** utilise un nom stable **dans le VPC** :

1. **Cloud Map** → **Create a namespace** (ex. `abstergo.local`).
2. Lors de la création du **service ECS** signaling, active **Service discovery** et crée un enregistrement **A** (ou SRV selon assistant) pointant vers les tâches.
3. Dans **monitor**, mets par ex. `SIGNALING_URL=http://signaling.abstergo.local:5174` (le nom exact dépend de l’assistant).  
   Vérifie que le **SG** du signaling autorise le **5174** depuis le SG des tâches monitor.

---

## 10. Créer les services ECS (console)

Pour chaque task definition : **Clusters** → ton cluster → **Services** → **Create**.

Paramètres typiques **Fargate** :

- **Launch type** : Fargate.
- **Task definition** : la famille + dernière révision.
- **Service name** : `signaling`, `monitor`, `application`.
- **Desired tasks** : `1` au minimum (plus pour la HA).
- **VPC** et **sous-réseaux** : mêmes que l’ALB ou sous-réseaux privés pour les tâches si l’ALB est public (pattern courant : tâches en **private subnet** + ALB en **public** — nécessite **NAT** pour pull ECR si les tâches n’ont pas d’IP publique).
- **Security groups** : ceux définis à la section 5.
- **Load balancing** :  
  - Pour **application** et **signaling** : attacher au **target group** correspondant ; le port du conteneur doit correspondre (80 / 5174).  
  - Pour **monitor** : idem si tu exposes via ALB.

Laisse **Enable service discovery** si tu as préparé Cloud Map (signaling).

Déploie les trois services. Attends le statut **Steady state** (tâches **RUNNING**).

---

## 11. DNS (Route 53 ou autre)

- Crée des enregistrements **A/ALIAS** (ou CNAME) :
  - `app.example.com` → ALB application  
  - `ws.example.com` → ALB signaling  
  - `monitor.example.com` → ALB monitor *(si public)*  

Les certificats **ACM** doivent couvrir ces noms (ou un wildcard).

**Important** : après avoir les vrais noms HTTPS, **rebuild** l’image **application** avec :

`VITE_API_URL=https://api...` et `VITE_SIGNALING_URL=https://ws...`  
puis **nouvelle** image ECR + **nouvelle révision** de task + **force new deployment** du service application.

---

## 12. Vérifications

| Vérification | Action |
|--------------|--------|
| Images présentes | ECR → chaque repo a une image récente |
| Tâches démarrées | ECS → service → onglet **Tasks** → **RUNNING** |
| Logs | **CloudWatch Logs** → groupes créés par la task definition |
| Front | Navigateur → `https://app.example.com` charge le SPA |
| WebSocket | Onglet Réseau du navigateur : connexion **wss** vers ton domaine WS / échec = vérifier ALB, SG, `VITE_SIGNALING_URL` |
| Monitor | `https://monitor.../api/health` → JSON avec `signalingConnected: true` si `SIGNALING_URL` est correct |
| Santé ALB | EC2 → Target groups → **Healthy** sur les cibles |

---

## 13. Bonnes pratiques sécurité

- Le signaling expose des handlers **admin** sans auth : garde **monitor** et accès **admin** **restreints** (réseau + IdP si possible).
- Préfère **HTTPS** partout côté client ; les variables `VITE_*` doivent utiliser **https://** et **wss** sera négocié par Socket.IO via le même host si tu alignes bien l’URL.
- Fais évoluer les images par **tags** (`v2026-04-07`) plutôt que seulement `latest`, et pince les task definitions sur des **digests** ou tags versionnés en prod.

---

## 14. Récapitulatif ordre opérationnel

1. Créer les **dépôts ECR** et pousser les **trois images** (application avec les bons **build-arg**).  
2. Créer **SG**, **cluster ECS**, éventuellement **namespace Cloud Map**.  
3. Créer les **target groups** et **ALB** (certificats ACM).  
4. Créer les **task definitions** (signaling, monitor, application).  
5. Créer les **services ECS** avec attachement aux target groups et bons **Security Groups**.  
6. Configurer **Route 53** (ou DNS externe).  
7. Tester ; ajuster **VITE_** et redéployer l’**application** si besoin.

Ce document est volontairement centré sur la **console** ; les mêmes briques se automatisent ensuite avec Terraform, CDK ou CloudFormation.
