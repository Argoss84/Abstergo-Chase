CREATE TABLE IF NOT EXISTS app_config_versions (
  config_key VARCHAR(64) NOT NULL,
  version INT UNSIGNED NOT NULL,
  value_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (config_key, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_config_versions (config_key, version, value_json)
VALUES ('progression', 1, JSON_OBJECT('win_xp', 150)),
       ('hosting', 1, JSON_OBJECT('free_daily_rounds', NULL, 'premium_daily_rounds', NULL, 'premium_settings', JSON_OBJECT()));

CREATE TABLE IF NOT EXISTS lobbies (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lobby_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  code VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS games (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  lobby_id BIGINT UNSIGNED NOT NULL,
  round_number INT UNSIGNED NOT NULL,
  status ENUM('running', 'ended', 'cancelled') NOT NULL DEFAULT 'running',
  host_user_id BIGINT UNSIGNED NULL,
  host_player_id VARCHAR(128) NULL,
  config_json JSON NOT NULL,
  hosting_config_version INT UNSIGNED NULL,
  progression_config_version INT UNSIGNED NULL,
  winner_side VARCHAR(32) NULL,
  end_reason VARCHAR(255) NULL,
  started_at DATETIME(3) NOT NULL,
  ended_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY lobby_round_number (lobby_id, round_number),
  KEY game_host_time (host_user_id, started_at),
  KEY game_status_time (status, ended_at),
  FOREIGN KEY (lobby_id) REFERENCES lobbies(id),
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_players (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  player_external_id VARCHAR(128) NOT NULL,
  display_name_snapshot VARCHAR(64) NOT NULL,
  role VARCHAR(32) NULL,
  team VARCHAR(32) NULL,
  is_host BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('active', 'left', 'disconnected', 'kicked') NOT NULL DEFAULT 'active',
  joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  left_at DATETIME(3) NULL,
  UNIQUE KEY game_account (game_id, user_id),
  KEY player_history (user_id, game_id),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  game_id BIGINT UNSIGNED NOT NULL,
  sequence_no BIGINT UNSIGNED NOT NULL,
  event_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  payload_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY game_event_order (game_id, sequence_no),
  UNIQUE KEY game_event_deduplication (game_id, event_key),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_results (
  game_id BIGINT UNSIGNED PRIMARY KEY,
  winning_side VARCHAR(32) NULL,
  end_reason VARCHAR(255) NULL,
  duration_seconds INT UNSIGNED NULL,
  summary_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS game_player_results (
  game_player_id BIGINT UNSIGNED PRIMARY KEY,
  score INT NOT NULL DEFAULT 0,
  objectives_completed INT UNSIGNED NOT NULL DEFAULT 0,
  reward_xp INT UNSIGNED NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (game_player_id) REFERENCES game_players(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS runtime_snapshots (
  scope VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  state_json JSON NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
