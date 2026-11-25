CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  cognito_issuer VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NULL,
  cognito_sub VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  email VARCHAR(254) NULL,
  username VARCHAR(32) NULL UNIQUE,
  status ENUM('active', 'suspended', 'deleted') NOT NULL DEFAULT 'active',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY user_cognito_identity (cognito_issuer, cognito_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  display_name VARCHAR(40) NULL,
  avatar_url VARCHAR(1024) NULL,
  bio VARCHAR(280) NULL,
  region VARCHAR(40) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id BIGINT UNSIGNED PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  preferences_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lobby_presets (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  config_json JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY user_preset_name (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS friendships (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_low_id BIGINT UNSIGNED NOT NULL,
  user_high_id BIGINT UNSIGNED NOT NULL,
  requester_id BIGINT UNSIGNED NOT NULL,
  addressee_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  accepted_at DATETIME(3) NULL,
  UNIQUE KEY friendship_pair (user_low_id, user_high_id),
  KEY friendship_recipient (addressee_id, status),
  KEY friendship_requester (requester_id, status),
  CHECK (user_low_id < user_high_id),
  FOREIGN KEY (user_low_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_high_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  target_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  payload_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY audit_actor_time (actor_user_id, created_at),
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
