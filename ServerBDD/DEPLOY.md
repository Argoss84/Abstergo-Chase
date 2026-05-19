# Déploiement ServerBDD (PostgreSQL + Cognito)

## Variables requises

- `PORT`
- `DATABASE_HOST`
- `DATABASE_PORT`
- `DATABASE_NAME`
- `DATABASE_USER`
- `DATABASE_PASSWORD`
- `DATABASE_SSL` (`true` ou `false`)
- `COGNITO_ISSUER` (ex: `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`)
- `COGNITO_AUDIENCE` (App Client ID Cognito)

## Commandes

```bash
npm ci
npm run migrate
npm start
```

## Vérification rapide

- Healthcheck API: `GET /health`
- Les endpoints métier `/api/*` exigent un JWT Cognito (`Authorization: Bearer ...`)

## Sécurité

- Ne pas exposer PostgreSQL publiquement.
- Restreindre l’API aux appels de l’application Android uniquement.
