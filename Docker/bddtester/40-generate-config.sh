#!/bin/sh
set -eu

envsubst '${API_BASE_URL} ${COGNITO_DOMAIN} ${COGNITO_CLIENT_ID} ${COGNITO_REDIRECT_URI} ${COGNITO_SCOPE}' \
  < /usr/share/nginx/html/config.template.js \
  > /usr/share/nginx/html/config.js
