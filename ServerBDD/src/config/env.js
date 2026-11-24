import dotenv from 'dotenv';

dotenv.config();

const required = [
  'DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER', 'DATABASE_PASSWORD',
  'COGNITO_ISSUER', 'COGNITO_AUDIENCE',
];
for (const name of required) {
  if (!process.env[name]) throw new Error('Missing required environment variable: ' + name);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5175),
  passenger: process.env.PASSENGER === 'true',
  database: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 3306),
    name: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true',
  },
  cognito: {
    issuer: process.env.COGNITO_ISSUER,
    audience: process.env.COGNITO_AUDIENCE,
  },
  signalingKey: process.env.SIGNALING_INTERNAL_TOKEN ?? '',
  adminKey: process.env.PLATFORM_ADMIN_TOKEN ?? '',
  diagnosticsUrl: process.env.DIAGNOSTICS_SERVER_URL ?? '',
  diagnosticsToken: process.env.DIAGNOSTICS_SERVER_TOKEN ?? '',
  play: {
    packageName: process.env.PLAY_PACKAGE_NAME ?? 'com.brokenveilprotocol.app',
    productId: process.env.PLAY_SUBSCRIPTION_PRODUCT_ID ?? '',
    basePlanId: process.env.PLAY_SUBSCRIPTION_BASE_PLAN_ID ?? '',
    clientEmail: process.env.PLAY_CLIENT_EMAIL ?? '',
    privateKey: process.env.PLAY_PRIVATE_KEY?.replaceAll('\\n', '\n') ?? '',
    pushEmail: process.env.PLAY_PUBSUB_PUSH_EMAIL ?? '',
    pushAudience: process.env.PLAY_PUBSUB_PUSH_AUDIENCE ?? '',
  },
};
