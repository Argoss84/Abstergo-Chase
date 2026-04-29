CREATE TYPE game_status AS ENUM ('lobby', 'running', 'ended', 'cancelled');
CREATE TYPE game_player_status AS ENUM ('active', 'left', 'disconnected', 'kicked');

CREATE TABLE games (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  status game_status NOT NULL DEFAULT 'lobby',
  host_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  host_player_id TEXT,
  config_json JSONB,
  winner_side TEXT,
  end_reason TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE game_players (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  player_external_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  role TEXT,
  team TEXT,
  is_host BOOLEAN NOT NULL DEFAULT false,
  status game_player_status NOT NULL DEFAULT 'active',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  UNIQUE (game_id, player_external_id)
);

CREATE TABLE game_events (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  actor_external_id TEXT,
  payload_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence_no BIGINT NOT NULL,
  UNIQUE (game_id, sequence_no)
);

CREATE TABLE game_results (
  game_id BIGINT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  winning_side TEXT,
  end_reason TEXT,
  duration_seconds INTEGER,
  summary_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE game_player_results (
  id BIGSERIAL PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  player_external_id TEXT NOT NULL,
  display_name_snapshot TEXT NOT NULL,
  role TEXT,
  team TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  objectives_completed INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  is_winner BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (game_id, player_external_id)
);

CREATE INDEX idx_games_status_created_at ON games (status, created_at DESC);
CREATE INDEX idx_game_players_game_id ON game_players (game_id);
CREATE INDEX idx_game_players_user_id ON game_players (user_id);
CREATE INDEX idx_game_events_game_seq ON game_events (game_id, sequence_no DESC);
CREATE INDEX idx_game_results_created_at ON game_results (created_at DESC);
