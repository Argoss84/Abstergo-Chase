class AppRuntimeConfig {
  const AppRuntimeConfig._();

  // Intervalle de publication des mises a jour temps reel.
  static const int gameRealtimeRefreshIntervalMs = 1000;

  // Cognito configuration (inject via --dart-define at build/run time).
  static const String cognitoUserPoolId = String.fromEnvironment(
    'COGNITO_USER_POOL_ID',
    defaultValue: '',
  );
  static const String cognitoClientId = String.fromEnvironment(
    'COGNITO_CLIENT_ID',
    defaultValue: '',
  );
  static const String cognitoRegion = String.fromEnvironment(
    'COGNITO_REGION',
    defaultValue: 'eu-west-3',
  );
  static const String cognitoDomain = String.fromEnvironment(
    'COGNITO_DOMAIN',
    defaultValue: '',
  );
  static const String cognitoRedirectUri = String.fromEnvironment(
    'COGNITO_REDIRECT_URI',
    defaultValue: 'com.abstergo.chase://oauth/callback',
  );
  static const String cognitoLogoutRedirectUri = String.fromEnvironment(
    'COGNITO_LOGOUT_REDIRECT_URI',
    defaultValue: 'com.abstergo.chase://oauth/signout',
  );
}
