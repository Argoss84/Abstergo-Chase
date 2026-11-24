CREATE TABLE IF NOT EXISTS play_plans (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  product_id VARCHAR(100) NOT NULL,
  base_plan_id VARCHAR(100) NOT NULL,
  UNIQUE KEY play_product_plan (product_id, base_plan_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_plan_features (
  plan_id BIGINT UNSIGNED NOT NULL,
  feature_code VARCHAR(80) NOT NULL,
  PRIMARY KEY (plan_id, feature_code),
  FOREIGN KEY (plan_id) REFERENCES play_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_subscriptions (
  purchase_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  play_state VARCHAR(64) NOT NULL,
  superseded_by CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at DATETIME(3) NOT NULL,
  KEY play_account_state (user_id, play_state),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_subscription_items (
  purchase_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (purchase_hash, plan_id),
  FOREIGN KEY (purchase_hash) REFERENCES play_subscriptions(purchase_hash) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES play_plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS play_billing_events (
  message_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  purchase_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type INT UNSIGNED NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
