import { transaction, readJson } from '../../db/pool.js';
import { gameDetails, getGameEvents, getHistory } from '../games/games.repository.js';
import { config as readConfig } from '../billing/billing.repository.js';
import { HttpError } from '../../utils/http-error.js';

export class AdminRepository {
  constructor(database) { this.database = database; }

  async audit(db, actor, action, targetUserId = null, details = {}) {
    await db.query(
      'INSERT INTO audit_logs (target_user_id, action, payload_json) VALUES (?, ?, ?)',
      [targetUserId, 'admin.' + action, JSON.stringify({ administrator: actor, ...details })]
    );
  }

  async consumeLoginAttempt(key) {
    return transaction(async (db) => {
      await db.query(
        'INSERT INTO admin_login_attempts (attempt_key, attempts) VALUES (?, 1) ' +
        'ON DUPLICATE KEY UPDATE attempts = IF(window_started_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE, 1, attempts + 1), ' +
        'window_started_at = IF(window_started_at < UTC_TIMESTAMP(3) - INTERVAL 15 MINUTE, UTC_TIMESTAMP(3), window_started_at)',
        [key]
      );
      const [[row]] = await db.query('SELECT attempts FROM admin_login_attempts WHERE attempt_key = ? FOR UPDATE', [key]);
      return Number(row.attempts) <= 10;
    }, this.database);
  }

  async createSession(session, attemptKey) {
    await transaction(async (db) => {
      await db.query('DELETE FROM admin_sessions WHERE expires_at <= UTC_TIMESTAMP(3)');
      await db.query('DELETE FROM admin_login_attempts WHERE window_started_at < UTC_TIMESTAMP(3) - INTERVAL 1 DAY');
      await db.query(
        'INSERT INTO admin_sessions (token_hash, login_name, credentials_hash, csrf_token, expires_at) VALUES (?, ?, ?, ?, ?)',
        [session.tokenHash, session.username, session.credentialsHash, session.csrfToken, session.expiresAt]
      );
      await db.query('DELETE FROM admin_login_attempts WHERE attempt_key = ?', [attemptKey]);
      await this.audit(db, session.username, 'login');
    }, this.database);
  }

  async session(tokenHash, credentialsHash) {
    const [[session]] = await this.database.query(
      'SELECT login_name AS username, csrf_token AS csrfToken, expires_at AS expiresAt FROM admin_sessions ' +
      'WHERE token_hash = ? AND credentials_hash = ? AND expires_at > UTC_TIMESTAMP(3)',
      [tokenHash, credentialsHash]
    );
    return session ?? null;
  }

  async deleteSession(tokenHash, actor) {
    await transaction(async (db) => {
      await db.query('DELETE FROM admin_sessions WHERE token_hash = ?', [tokenHash]);
      await this.audit(db, actor, 'logout');
    }, this.database);
  }

  async overview() {
    const [[counts]] = await this.database.query(
      'SELECT (SELECT COUNT(*) FROM users) AS users, ' +
      "(SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspended, " +
      '(SELECT COUNT(*) FROM games WHERE started_at >= UTC_DATE()) AS rounds_today, ' +
      "(SELECT COUNT(*) FROM games WHERE status = 'running') AS running_rounds, " +
      '(SELECT COUNT(DISTINCT user_id) FROM game_players WHERE joined_at >= UTC_DATE()) AS players_today, ' +
      '(SELECT COUNT(*) FROM user_active_sessions WHERE expires_at > UTC_TIMESTAMP(3)) AS valid_sessions, ' +
      '(SELECT COUNT(DISTINCT s.user_id) FROM play_subscriptions s JOIN play_subscription_items i ON i.purchase_hash = s.purchase_hash ' +
      "WHERE s.superseded_by IS NULL AND s.play_state IN ('SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED') " +
      'AND i.expires_at > UTC_TIMESTAMP(3)) AS subscribers'
    );
    const [activity] = await this.database.query(
      'SELECT DATE(started_at) AS day, COUNT(*) AS rounds FROM games ' +
      'WHERE started_at >= UTC_DATE() - INTERVAL 6 DAY GROUP BY DATE(started_at) ORDER BY day'
    );
    return { counts, activity, generatedAt: new Date().toISOString() };
  }

  async players({ search, status, page, limit }) {
    const conditions = ['1 = 1'];
    const params = [];
    if (search) {
      conditions.push('(u.username LIKE ? OR p.display_name LIKE ? OR u.email LIKE ? OR u.public_id = ?)');
      const value = '%' + search.replace(/[\\%_]/g, (character) => '\\' + character) + '%';
      params.push(value, value, value, search);
    }
    if (status) { conditions.push('u.status = ?'); params.push(status); }
    const where = ' FROM users u LEFT JOIN player_profiles p ON p.user_id = u.id WHERE ' + conditions.join(' AND ');
    const [[count]] = await this.database.query('SELECT COUNT(*) AS total' + where, params);
    const [rows] = await this.database.query(
      'SELECT u.id, u.public_id, u.username, u.email, u.status, u.created_at, p.display_name, ' +
      '(SELECT level FROM player_stats WHERE user_id = u.id) AS level, ' +
      'EXISTS(SELECT 1 FROM user_active_sessions WHERE user_id = u.id AND expires_at > UTC_TIMESTAMP(3)) AS has_session' +
      where + ' ORDER BY u.id DESC LIMIT ? OFFSET ?', [...params, limit, (page - 1) * limit]
    );
    return { rows, total: Number(count.total), page, limit };
  }

  async player(id) {
    const [[player]] = await this.database.query(
      'SELECT u.id, u.public_id, u.username, u.email, u.status, u.created_at, p.display_name, p.bio, p.region, ' +
      'COALESCE(s.level, 1) AS level, COALESCE(s.xp, 0) AS xp, COALESCE(s.wins, 0) AS wins, COALESCE(s.losses, 0) AS losses ' +
      'FROM users u LEFT JOIN player_profiles p ON p.user_id = u.id LEFT JOIN player_stats s ON s.user_id = u.id WHERE u.id = ?',
      [id]
    );
    if (!player) throw new HttpError(404, 'Joueur introuvable');
    return { player, games: await getHistory(id, null, 10) };
  }

  async setPlayerStatus(id, status, reason, actor) {
    return transaction(async (db) => {
      const [[player]] = await db.query('SELECT status FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!player) throw new HttpError(404, 'Joueur introuvable');
      if (player.status === 'deleted') throw new HttpError(409, 'Ce compte est décommissionné');
      await db.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
      if (status === 'suspended') {
        await db.query('DELETE FROM user_active_sessions WHERE user_id = ?', [id]);
        await db.query('DELETE FROM signaling_tickets WHERE user_id = ?', [id]);
      }
      await this.audit(db, actor, 'player_status', id, { before: player.status, after: status, reason });
      return { success: true };
    }, this.database);
  }

  async revokePlayerSessions(id, reason, actor) {
    return transaction(async (db) => {
      const [[user]] = await db.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [id]);
      if (!user) throw new HttpError(404, 'Joueur introuvable');
      await db.query('DELETE FROM user_active_sessions WHERE user_id = ?', [id]);
      await db.query('DELETE FROM signaling_tickets WHERE user_id = ?', [id]);
      await this.audit(db, actor, 'revoke_sessions', id, { reason });
      return { success: true };
    }, this.database);
  }

  async games({ search, status, page, limit }) {
    const conditions = ['1 = 1'];
    const params = [];
    if (search) { conditions.push('l.code = ?'); params.push(search.toUpperCase()); }
    if (status) { conditions.push('g.status = ?'); params.push(status); }
    const where = ' FROM games g JOIN lobbies l ON l.id = g.lobby_id WHERE ' + conditions.join(' AND ');
    const [[count]] = await this.database.query('SELECT COUNT(*) AS total' + where, params);
    const [rows] = await this.database.query(
      'SELECT g.id, g.round_number, l.code, g.status, g.winner_side, g.started_at, g.ended_at, ' +
      '(SELECT COUNT(*) FROM game_players WHERE game_id = g.id) AS player_count' +
      where + ' ORDER BY g.id DESC LIMIT ? OFFSET ?', [...params, limit, (page - 1) * limit]
    );
    return { rows, total: Number(count.total), page, limit };
  }

  async game(id, offset = 0) {
    const [[row]] = await this.database.query(
      'SELECT g.*, l.code FROM games g JOIN lobbies l ON l.id = g.lobby_id WHERE g.id = ?', [id]
    );
    if (!row) throw new HttpError(404, 'Manche introuvable');
    const game = { ...row, config_json: readJson(row.config_json) };
    const events = await getGameEvents(id, 100, offset);
    return { ...await gameDetails(game), events, nextOffset: events.length === 100 ? offset + 100 : null };
  }

  async subscriptions({ page, limit }) {
    const [[count]] = await this.database.query('SELECT COUNT(*) AS total FROM play_subscription_items');
    const [rows] = await this.database.query(
      'SELECT u.id AS user_id, u.username, p.display_name, s.play_state, s.acknowledged, s.verified_at, ' +
      'i.expires_at, plan.product_id, plan.base_plan_id, (s.superseded_by IS NOT NULL) AS superseded ' +
      'FROM play_subscriptions s JOIN users u ON u.id = s.user_id LEFT JOIN player_profiles p ON p.user_id = u.id ' +
      'JOIN play_subscription_items i ON i.purchase_hash = s.purchase_hash JOIN play_plans plan ON plan.id = i.plan_id ' +
      'ORDER BY s.verified_at DESC, s.purchase_hash, i.plan_id LIMIT ? OFFSET ?', [limit, (page - 1) * limit]
    );
    return { rows, total: Number(count.total), page, limit };
  }

  async settings() {
    const [progression, hosting, [levels], [bonuses]] = await Promise.all([
      readConfig(this.database, 'progression'), readConfig(this.database, 'hosting'),
      this.database.query('SELECT level, required_xp FROM level_thresholds ORDER BY level'),
      this.database.query('SELECT id, label, description, minimum_level, allowed_role, use_type, initial_charges, enabled FROM bonuses ORDER BY minimum_level, id'),
    ]);
    return { progression, hosting, levels, bonuses };
  }

  async publishSettings(key, version, values, actor) {
    return transaction(async (db) => {
      // The seeded first version is a stable lock for this configuration key.
      // Lock it before reading the latest version to serialize concurrent edits.
      await db.query('SELECT version FROM app_config_versions WHERE config_key = ? AND version = 1 FOR UPDATE', [key]);
      const [[current]] = await db.query(
        'SELECT version, value_json FROM app_config_versions WHERE config_key = ? ORDER BY version DESC LIMIT 1 FOR UPDATE', [key]
      );
      if ((current?.version ?? 0) !== version) throw new HttpError(409, 'Les réglages ont changé. Actualise avant de réessayer.');
      const before = readJson(current?.value_json, {});
      const next = { ...before, ...values };
      await db.query('INSERT INTO app_config_versions (config_key, version, value_json) VALUES (?, ?, ?)',
        [key, version + 1, JSON.stringify(next)]);
      await this.audit(db, actor, 'publish_settings', null, { key, version: version + 1, before, after: next });
      return { version: version + 1, values: next };
    }, this.database);
  }

  async auditLog({ page, limit }) {
    const [[count]] = await this.database.query("SELECT COUNT(*) AS total FROM audit_logs WHERE action LIKE 'admin.%'");
    const [rows] = await this.database.query(
      "SELECT id, action, target_user_id, payload_json, created_at FROM audit_logs WHERE action LIKE 'admin.%' " +
      'ORDER BY id DESC LIMIT ? OFFSET ?', [limit, (page - 1) * limit]
    );
    return { rows: rows.map((row) => ({ ...row, payload_json: readJson(row.payload_json) })),
      total: Number(count.total), page, limit };
  }

  async recordAction(actor, action, details) {
    await this.audit(this.database, actor, action, null, details);
  }
}
