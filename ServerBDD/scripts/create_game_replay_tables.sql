-- Tables pour le système de replay vidéo accéléré des parties
-- Exécuter ce script sur la base MySQL/MariaDB

-- Table des sessions de jeu (métadonnées)
CREATE TABLE IF NOT EXISTS game_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_code VARCHAR(10) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  winner_type VARCHAR(20) NULL,
  config_json JSON NULL,
  INDEX idx_game_code (game_code),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table des snapshots temporels pour le replay
CREATE TABLE IF NOT EXISTS game_replay_snapshots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  game_session_id INT NOT NULL,
  snapshot_timestamp DATETIME NOT NULL,
  remaining_time_seconds INT NULL,
  game_phase VARCHAR(20) NULL,
  players_json JSON NULL,
  props_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE,
  INDEX idx_session_timestamp (game_session_id, snapshot_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
