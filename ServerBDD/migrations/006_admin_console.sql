CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  login_name VARCHAR(80) NOT NULL,
  credentials_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  csrf_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  KEY admin_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  attempt_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  window_started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY admin_attempt_expiry (window_started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
