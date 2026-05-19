import { pool } from '../../db/pool.js';

export async function createOrUpdateGame({
  gameCode,
  hostUserId = null,
  hostPlayerId = null,
  configJson = null,
}) {
  const result = await pool.query(
    `
    INSERT INTO games (code, host_user_id, host_player_id, config_json)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (code)
    DO UPDATE SET
      host_user_id = COALESCE(EXCLUDED.host_user_id, games.host_user_id),
      host_player_id = COALESCE(EXCLUDED.host_player_id, games.host_player_id),
      config_json = COALESCE(EXCLUDED.config_json, games.config_json),
      updated_at = NOW()
    RETURNING *
    `,
    [gameCode, hostUserId, hostPlayerId, configJson ? JSON.stringify(configJson) : null]
  );
  return result.rows[0];
}

export async function getGameByCode(gameCode) {
  const result = await pool.query('SELECT * FROM games WHERE code = $1', [gameCode]);
  return result.rows[0] ?? null;
}

export async function listRecentGames(limit = 30) {
  const result = await pool.query(
    `
    SELECT id, code, status, winner_side, end_reason, created_at, updated_at
    FROM games
    WHERE code ~ '^[A-Z]+$'
    ORDER BY updated_at DESC
    LIMIT $1
    `,
    [limit]
  );
  return result.rows;
}

export async function setGameStatus({ gameCode, status, winnerSide = null, endReason = null }) {
  const result = await pool.query(
    `
    UPDATE games
    SET
      status = $2::game_status,
      winner_side = COALESCE($3, winner_side),
      end_reason = COALESCE($4, end_reason),
      started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
      ended_at = CASE WHEN $2 IN ('ended', 'cancelled') THEN NOW() ELSE ended_at END,
      updated_at = NOW()
    WHERE code = $1
    RETURNING *
    `,
    [gameCode, status, winnerSide, endReason]
  );
  return result.rows[0] ?? null;
}

export async function upsertGamePlayer({
  gameId,
  playerExternalId,
  displayNameSnapshot,
  userId = null,
  role = null,
  team = null,
  isHost = false,
  status = 'active',
}) {
  const result = await pool.query(
    `
    INSERT INTO game_players
      (game_id, player_external_id, display_name_snapshot, user_id, role, team, is_host, status)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::game_player_status)
    ON CONFLICT (game_id, player_external_id)
    DO UPDATE SET
      display_name_snapshot = EXCLUDED.display_name_snapshot,
      user_id = COALESCE(EXCLUDED.user_id, game_players.user_id),
      role = COALESCE(EXCLUDED.role, game_players.role),
      team = COALESCE(EXCLUDED.team, game_players.team),
      is_host = EXCLUDED.is_host,
      status = EXCLUDED.status,
      left_at = CASE WHEN EXCLUDED.status = 'left' THEN NOW() ELSE NULL END
    RETURNING *
    `,
    [gameId, playerExternalId, displayNameSnapshot, userId, role, team, isHost, status]
  );
  return result.rows[0];
}

export async function appendGameEvent({
  gameId,
  eventType,
  actorUserId = null,
  actorExternalId = null,
  payloadJson = null,
  createdAt = null,
}) {
  const result = await pool.query(
    `
    WITH next_seq AS (
      SELECT COALESCE(MAX(sequence_no), 0) + 1 AS seq
      FROM game_events
      WHERE game_id = $1
    )
    INSERT INTO game_events
      (game_id, event_type, actor_user_id, actor_external_id, payload_json, created_at, sequence_no)
    SELECT
      $1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()), next_seq.seq
    FROM next_seq
    RETURNING *
    `,
    [gameId, eventType, actorUserId, actorExternalId, payloadJson ? JSON.stringify(payloadJson) : null, createdAt]
  );
  return result.rows[0];
}

export async function getGameEvents(gameId, limit = 200, offset = 0) {
  const result = await pool.query(
    `
    SELECT *
    FROM game_events
    WHERE game_id = $1
    ORDER BY sequence_no ASC
    LIMIT $2 OFFSET $3
    `,
    [gameId, limit, offset]
  );
  return result.rows;
}

export async function upsertGameResult({
  gameId,
  winningSide = null,
  endReason = null,
  durationSeconds = null,
  summaryJson = null,
}) {
  const result = await pool.query(
    `
    INSERT INTO game_results
      (game_id, winning_side, end_reason, duration_seconds, summary_json)
    VALUES
      ($1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (game_id)
    DO UPDATE SET
      winning_side = EXCLUDED.winning_side,
      end_reason = EXCLUDED.end_reason,
      duration_seconds = EXCLUDED.duration_seconds,
      summary_json = EXCLUDED.summary_json
    RETURNING *
    `,
    [gameId, winningSide, endReason, durationSeconds, summaryJson ? JSON.stringify(summaryJson) : null]
  );
  return result.rows[0];
}

export async function upsertGamePlayerResult({
  gameId,
  playerExternalId,
  displayNameSnapshot,
  userId = null,
  role = null,
  team = null,
  score = 0,
  kills = 0,
  deaths = 0,
  objectivesCompleted = 0,
  rewardXp = 0,
  isWinner = false,
}) {
  const result = await pool.query(
    `
    INSERT INTO game_player_results
      (game_id, player_external_id, display_name_snapshot, user_id, role, team, score, kills, deaths, objectives_completed, reward_xp, is_winner)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (game_id, player_external_id)
    DO UPDATE SET
      display_name_snapshot = EXCLUDED.display_name_snapshot,
      user_id = COALESCE(EXCLUDED.user_id, game_player_results.user_id),
      role = EXCLUDED.role,
      team = EXCLUDED.team,
      score = EXCLUDED.score,
      kills = EXCLUDED.kills,
      deaths = EXCLUDED.deaths,
      objectives_completed = EXCLUDED.objectives_completed,
      reward_xp = EXCLUDED.reward_xp,
      is_winner = EXCLUDED.is_winner
    RETURNING *
    `,
    [
      gameId,
      playerExternalId,
      displayNameSnapshot,
      userId,
      role,
      team,
      score,
      kills,
      deaths,
      objectivesCompleted,
      rewardXp,
      isWinner,
    ]
  );
  return result.rows[0];
}

export async function applyProgressionFromResult({ userId, rewardXp = 0, isWinner = false }) {
  if (!userId) return;
  await pool.query(
    `
    INSERT INTO player_stats (user_id)
    VALUES ($1)
    ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );

  await pool.query(
    `
    UPDATE player_stats
    SET
      xp = GREATEST(0, xp + $2),
      wins = wins + CASE WHEN $3 THEN 1 ELSE 0 END,
      losses = losses + CASE WHEN $3 THEN 0 ELSE 1 END,
      level = GREATEST(1, ((GREATEST(0, xp + $2) / 1000) + 1)),
      updated_at = NOW()
    WHERE user_id = $1
    `,
    [userId, rewardXp, isWinner]
  );
}

export async function insertAuditLog({ actorUserId = null, targetUserId = null, action, payloadJson = null }) {
  await pool.query(
    `
    INSERT INTO audit_logs (actor_user_id, target_user_id, action, payload_json)
    VALUES ($1, $2, $3, $4::jsonb)
    `,
    [actorUserId, targetUserId, action, payloadJson ? JSON.stringify(payloadJson) : null]
  );
}

export async function getGameWithDetails(gameCode) {
  const game = await getGameByCode(gameCode);
  if (!game) return null;
  const [players, events, result, playerResults] = await Promise.all([
    pool.query('SELECT * FROM game_players WHERE game_id = $1 ORDER BY joined_at ASC', [game.id]),
    pool.query('SELECT * FROM game_events WHERE game_id = $1 ORDER BY sequence_no ASC LIMIT 500', [game.id]),
    pool.query('SELECT * FROM game_results WHERE game_id = $1', [game.id]),
    pool.query('SELECT * FROM game_player_results WHERE game_id = $1 ORDER BY id ASC', [game.id]),
  ]);

  return {
    game,
    players: players.rows,
    events: events.rows,
    result: result.rows[0] ?? null,
    playerResults: playerResults.rows,
  };
}
