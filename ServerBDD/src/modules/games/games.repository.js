import { randomUUID } from 'node:crypto';
import { pool, readJson, transaction } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { config, enforceHosting } from '../billing/billing.repository.js';
import { applyOutcome, loadout } from '../progression/progression.repository.js';

export async function reserveLobby({ code, lobby_key: lobbyKey }) {
  try {
    await pool.query('INSERT INTO lobbies (lobby_key, code) VALUES (?, ?)', [lobbyKey, code]);
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [[row]] = await pool.query('SELECT lobby_key FROM lobbies WHERE code = ?', [code]);
    if (row?.lobby_key !== lobbyKey) throw new HttpError(409, 'Code de salon déjà attribué');
  }
}

export async function acquireRuntime(scope) {
  return transaction(async (db) => {
    const owner = randomUUID();
    await db.query(
      'INSERT INTO runtime_snapshots (scope, owner_key) VALUES (?, ?) ON DUPLICATE KEY UPDATE owner_key = ?, revision = 0',
      [scope, owner, owner]
    );
    const [[row]] = await db.query('SELECT state_json FROM runtime_snapshots WHERE scope = ?', [scope]);
    return { owner_key: owner, state: readJson(row.state_json) };
  });
}

export async function saveRuntime(db, { scope, owner_key: owner, revision, state }) {
  const [result] = await db.query(
    'UPDATE runtime_snapshots SET revision = ?, state_json = ? WHERE scope = ? AND owner_key = ? AND revision < ?',
    [revision, JSON.stringify(state), scope, owner, revision]
  );
  if (result.affectedRows) return;
  const [[current]] = await db.query('SELECT owner_key, revision FROM runtime_snapshots WHERE scope = ?', [scope]);
  if (current?.owner_key !== owner || Number(current.revision) < revision) {
    throw new HttpError(409, 'La signalisation ne détient plus la session de persistance');
  }
}

export async function appendGameEvent({ gameId, eventKey = randomUUID(), eventType, actorUserId = null, payloadJson = null }) {
  return transaction(async (db) => {
    const [[game]] = await db.query('SELECT id FROM games WHERE id = ? FOR UPDATE', [gameId]);
    if (!game) throw new HttpError(404, 'Partie introuvable');
    return appendEvent(db, game.id, eventKey, eventType, actorUserId, payloadJson);
  });
}

async function appendEvent(db, gameId, eventKey, eventType, actorUserId = null, payload = null) {
  const [[existing]] = await db.query('SELECT * FROM game_events WHERE game_id = ? AND event_key = ?', [gameId, eventKey]);
  if (existing) return { ...existing, payload_json: readJson(existing.payload_json) };

  const [[{ sequence_no: sequence }]] = await db.query(
    'SELECT COALESCE(MAX(sequence_no), 0) + 1 AS sequence_no FROM game_events WHERE game_id = ?',
    [gameId]
  );
  const [result] = await db.query(
    'INSERT INTO game_events (game_id, sequence_no, event_key, event_type, actor_user_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)',
    [gameId, sequence, eventKey, eventType, actorUserId, payload == null ? null : JSON.stringify(payload)]
  );
  return { id: result.insertId, sequence_no: sequence, event_type: eventType, payload_json: payload };
}

export async function startRound(round) {
  return transaction(async (db) => {
    const [[lobby]] = await db.query('SELECT id, code FROM lobbies WHERE lobby_key = ? FOR UPDATE', [round.lobby_key]);
    if (!lobby || lobby.code !== round.code) throw new HttpError(404, 'Salon introuvable');

    const [[existing]] = await db.query(
      'SELECT id, lobby_id, round_number, status FROM games WHERE round_key = ?',
      [round.round_key]
    );
    let current = existing;
    if (current && (current.lobby_id !== lobby.id || current.status !== 'running')) {
      throw new HttpError(409, 'Cet identifiant désigne déjà une autre manche ou une manche terminée');
    }
    if (!current) {
      const [[unfinished]] = await db.query("SELECT id FROM games WHERE lobby_id = ? AND status = 'running' LIMIT 1", [lobby.id]);
      if (unfinished) throw new HttpError(409, 'Une manche est déjà en cours dans ce salon');

      const [[host]] = await db.query('SELECT status FROM users WHERE id = ? FOR UPDATE', [round.host_user_id]);
      if (host?.status !== 'active') throw new HttpError(401, 'Hôte de partie invalide');
      const settingsVersion = await enforceHosting(db, round.host_user_id, round.config);
      const progression = await config(db, 'progression');
      const [[next]] = await db.query(
        'SELECT COALESCE(MAX(round_number), 0) + 1 AS round_number FROM games WHERE lobby_id = ?',
        [lobby.id]
      );
      const [saved] = await db.query(
        'INSERT INTO games (round_key, lobby_id, round_number, host_user_id, host_player_id, config_json, ' +
        'hosting_config_version, progression_config_version, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))',
        [round.round_key, lobby.id, next.round_number, round.host_user_id, round.host_player_id,
          JSON.stringify(round.config), settingsVersion, progression.version]
      );
      current = { id: saved.insertId, round_number: next.round_number };
      const players = [...round.players].sort((a, b) => a.user_id - b.user_id);
      for (const player of players) await saveParticipant(db, current.id, player);
      await appendEvent(db, current.id, 'started', 'game:started', round.host_user_id, { code: round.code });
    }
    if (round.checkpoint) await saveRuntime(db, round.checkpoint);
    const bonusesByPlayer = {};
    for (const player of round.players) bonusesByPlayer[player.player_external_id] = await loadout(db, player.user_id, player.role);
    return { round_key: round.round_key, round_number: current.round_number, bonuses_by_player: bonusesByPlayer };
  });
}

async function saveParticipant(db, gameId, player) {
  await db.query(
    'INSERT INTO game_players (game_id, user_id, player_external_id, display_name_snapshot, role, is_host, status) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE player_external_id = ?, status = ?',
    [gameId, player.user_id, player.player_external_id, player.display_name, player.role, player.is_host,
      player.status, player.player_external_id, player.status]
  );
}

export async function completeRound(roundKey, outcome) {
  return transaction(async (db) => {
    const [[game]] = await db.query('SELECT * FROM games WHERE round_key = ? FOR UPDATE', [roundKey]);
    if (!game) throw new HttpError(404, 'Partie introuvable');
    if (game.status !== 'running') return { status: game.status };
    if (outcome.runtime_scope) {
      const [[runtime]] = await db.query('SELECT owner_key FROM runtime_snapshots WHERE scope = ? FOR UPDATE',
        [outcome.runtime_scope]);
      if (runtime?.owner_key !== outcome.runtime_owner) {
        throw new HttpError(409, 'La signalisation ne détient plus la session de persistance');
      }
    }

    const byUser = new Map(outcome.players.map((player) => [player.user_id, player]));
    const [players] = await db.query('SELECT * FROM game_players WHERE game_id = ? ORDER BY user_id', [game.id]);
    const winner = outcome.winner_side;
    const status = winner ? 'ended' : 'cancelled';
    const { values } = await config(db, 'progression', game.progression_config_version);
    const winXp = Number.isInteger(values.win_xp) && values.win_xp >= 0 && values.win_xp <= 100000 ? values.win_xp : 0;

    await db.query(
      'UPDATE games SET status = ?, winner_side = ?, end_reason = ?, ended_at = UTC_TIMESTAMP(3) WHERE id = ?',
      [status, winner, outcome.end_reason, game.id]
    );
    await db.query(
      'INSERT INTO game_results (game_id, winning_side, end_reason, duration_seconds, summary_json) VALUES (?, ?, ?, ?, ?)',
      [game.id, winner, outcome.end_reason, outcome.duration_seconds, JSON.stringify(outcome.summary)]
    );

    for (const player of players) {
      const final = byUser.get(player.user_id);
      const finalStatus = final?.status ?? 'left';
      const completed = Boolean(winner) && ['active', 'disconnected'].includes(finalStatus);
      const won = completed && player.role === winner;
      const points = await applyOutcome(db, player, roundKey, won, completed, winXp);
      await db.query(
        "UPDATE game_players SET status = ?, left_at = IF(? IN ('left', 'kicked'), UTC_TIMESTAMP(3), left_at) WHERE id = ?",
        [finalStatus, finalStatus, player.id]
      );
      await db.query(
        'INSERT INTO game_player_results (game_player_id, objectives_completed, reward_xp, is_winner) VALUES (?, ?, ?, ?)',
        [player.id, final?.objectives_completed ?? 0, points, won]
      );
    }
    await appendEvent(db, game.id, 'ended', 'game:' + status, null, { winner_side: winner, end_reason: outcome.end_reason });
    return { status };
  });
}

export async function getGameEvents(gameId, limit = 200, offset = 0) {
  const [rows] = await pool.query(
    'SELECT * FROM game_events WHERE game_id = ? ORDER BY sequence_no LIMIT ? OFFSET ?',
    [gameId, limit, offset]
  );
  return rows.map((row) => ({ ...row, payload_json: readJson(row.payload_json) }));
}

export async function gameByCode(code) {
  const [[game]] = await pool.query(
    'SELECT g.*, l.code FROM games g JOIN lobbies l ON l.id = g.lobby_id WHERE l.code = ? ORDER BY g.round_number DESC LIMIT 1',
    [code]
  );
  if (!game) throw new HttpError(404, 'Partie introuvable');
  return { ...game, config_json: readJson(game.config_json) };
}

export async function gameDetails(game) {
  const [players] = await pool.query(
    'SELECT p.*, u.public_id, u.status AS account_status, r.score, r.reward_xp, r.is_winner, r.objectives_completed ' +
    'FROM game_players p JOIN users u ON u.id = p.user_id ' +
    'LEFT JOIN game_player_results r ON r.game_player_id = p.id WHERE p.game_id = ? ORDER BY p.joined_at, p.id',
    [game.id]
  );
  const [[result]] = await pool.query('SELECT * FROM game_results WHERE game_id = ?', [game.id]);
  return { game, players, result: result ? { ...result, summary_json: readJson(result.summary_json) } : null };
}

export async function getHistory(userId, before, limit) {
  const [games] = await pool.query(
    'SELECT g.id, g.round_key, g.round_number, g.status, l.code, g.started_at, g.ended_at, g.winner_side, g.end_reason, ' +
    'p.role, p.status AS player_status, COALESCE(r.is_winner, 0) AS is_winner, COALESCE(r.reward_xp, 0) AS reward_xp, ' +
    'COALESCE(r.objectives_completed, 0) AS objectives_completed, gr.duration_seconds FROM game_players p ' +
    'JOIN games g ON g.id = p.game_id JOIN lobbies l ON l.id = g.lobby_id ' +
    'LEFT JOIN game_player_results r ON r.game_player_id = p.id LEFT JOIN game_results gr ON gr.game_id = g.id ' +
    'WHERE p.user_id = ? AND g.ended_at IS NOT NULL ' + (before ? 'AND g.id < ? ' : '') +
    'ORDER BY g.id DESC LIMIT ?',
    before ? [userId, before, limit] : [userId, limit]
  );
  if (!games.length) return [];
  const [players] = await pool.query(
    'SELECT p.game_id, p.display_name_snapshot, p.role, p.status, u.public_id, u.status AS account_status ' +
    'FROM game_players p JOIN users u ON u.id = p.user_id WHERE p.game_id IN (?) ORDER BY p.joined_at, p.id',
    [games.map((game) => game.id)]
  );
  const byGame = new Map();
  for (const player of players) {
    if (!byGame.has(player.game_id)) byGame.set(player.game_id, []);
    byGame.get(player.game_id).push(player);
  }
  return games.map((game) => ({ ...game, players: byGame.get(game.id) ?? [] }));
}
