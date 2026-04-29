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

  // Signaling + voice network configuration.
  static const String signalingProductionUrl = String.fromEnvironment(
    'SIGNALING_PRODUCTION_URL',
    defaultValue: 'http://35.181.228.185',
  );
  static const String signalingDevelopmentUrl = String.fromEnvironment(
    'SIGNALING_DEVELOPMENT_URL',
    defaultValue: 'http://10.0.2.2:5174',
  );
  static const String socketPath = String.fromEnvironment(
    'SIGNALING_SOCKET_PATH',
    defaultValue: '/socket.io',
  );
  static const String defaultStunUrl = String.fromEnvironment(
    'VOICE_STUN_URL',
    defaultValue: 'stun:35.181.228.185:3478',
  );

  // ServerBDD profile API configuration.
  static const String serverBddProductionUrl = String.fromEnvironment(
    'SERVERBDD_PRODUCTION_URL',
    defaultValue: 'http://35.181.228.185:5175',
  );
  static const String serverBddDevelopmentUrl = String.fromEnvironment(
    'SERVERBDD_DEVELOPMENT_URL',
    defaultValue: 'http://10.0.2.2:5175',
  );
}
