import 'dotenv/config';

export function loadConfig(values = process.env) {
  for (const name of ['DATABASE_HOST', 'DATABASE_NAME', 'DATABASE_USER',
    'DATABASE_PASSWORD', 'COGNITO_ISSUER', 'COGNITO_CLIENT_ID', 'ERROR_ADMIN_TOKEN']) {
    if (!values[name]) throw new Error(`Missing configuration: ${name}`);
  }
  if (!/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[\w-]+$/.test(values.COGNITO_ISSUER)) {
    throw new Error('COGNITO_ISSUER must be the HTTPS URL of your Cognito user pool');
  }
  if (values.ERROR_ADMIN_TOKEN.length < 32 || values.ERROR_ADMIN_TOKEN.startsWith('replace-')) {
    throw new Error('ERROR_ADMIN_TOKEN must contain at least 32 random characters');
  }
  const trustProxy = Number(values.TRUST_PROXY ?? 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 3) {
    throw new Error('TRUST_PROXY must be a number of trusted reverse proxies (0-3)');
  }
  const basePath = values.APP_BASE_PATH ?? '';
  if (basePath && !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath)) {
    throw new Error('APP_BASE_PATH must be an absolute URL path without a trailing slash');
  }
  return {
    port: Number(values.PORT ?? 5180),
    production: values.NODE_ENV === 'production',
    trustProxy,
    basePath,
    passenger: values.PASSENGER === 'true',
    serverToken: values.DIAGNOSTICS_SERVER_TOKEN ?? '',
    issuer: values.COGNITO_ISSUER,
    clientId: values.COGNITO_CLIENT_ID,
    adminToken: values.ERROR_ADMIN_TOKEN,
    database: {
      host: values.DATABASE_HOST,
      port: Number(values.DATABASE_PORT ?? 3306),
      database: values.DATABASE_NAME,
      user: values.DATABASE_USER,
      password: values.DATABASE_PASSWORD,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      connectionLimit: 5,
      waitForConnections: true,
      queueLimit: 20,
      connectTimeout: 10000,
      ...(values.DATABASE_SSL === 'true' ? { ssl: { rejectUnauthorized: true } } : {}),
    },
  };
}
