CREATE TABLE IF NOT EXISTS diagnostic_events (
  event_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  source VARCHAR(64) NOT NULL,
  severity ENUM('info', 'warn', 'error') NOT NULL,
  event_code VARCHAR(80) NOT NULL,
  round_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  trace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY diagnostics_time (received_at),
  KEY diagnostics_round_time (round_key, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_route_samples (
  event_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  environment VARCHAR(32) NOT NULL,
  phase ENUM('lobby', 'game', 'unknown') NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  p2p_bytes BIGINT UNSIGNED NOT NULL,
  own_turn_bytes BIGINT UNSIGNED NOT NULL,
  other_turn_bytes BIGINT UNSIGNED NOT NULL,
  unknown_bytes BIGINT UNSIGNED NOT NULL,
  measured_intervals INT UNSIGNED NOT NULL,
  unmeasurable_intervals INT UNSIGNED NOT NULL,
  KEY voice_environment_time (environment, occurred_at),
  KEY voice_received_time (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
