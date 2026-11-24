-- Compatible with MariaDB 10.6+ and MySQL 8.0+.
CREATE TABLE IF NOT EXISTS error_events (
  event_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  environment VARCHAR(32) NOT NULL,
  platform VARCHAR(32) NOT NULL,
  build_mode VARCHAR(16) NOT NULL,
  app_version VARCHAR(64) NOT NULL,
  source VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  error_type VARCHAR(255) NULL,
  error_text TEXT NULL,
  stack_trace MEDIUMTEXT NULL,
  route VARCHAR(255) NULL,
  app_state VARCHAR(32) NULL,
  uploaded_by CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (event_id),
  KEY error_events_session_time (session_id, occurred_at),
  KEY error_events_time (occurred_at),
  KEY error_events_environment_time (environment, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
