import dotenv from 'dotenv';

dotenv.config();

const requiredVars = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_NAME',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'COGNITO_ISSUER',
  'COGNITO_AUDIENCE',
];

for (const key of requiredVars) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 5175),
  database: {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    name: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true',
  },
  cognito: {
    issuer: process.env.COGNITO_ISSUER,
    audience: process.env.COGNITO_AUDIENCE,
  },
};
