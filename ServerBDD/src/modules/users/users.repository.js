import { randomUUID } from 'node:crypto';
import { pool, readJson, transaction } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

export async function loadProfile(userId, db = pool) {
  const [[row]] = await db.query(
    'SELECT u.id, u.public_id, u.cognito_sub, u.email, u.username, u.status, u.created_at, u.updated_at, ' +
    'p.display_name, p.avatar_url, p.bio, p.region, s.preferences_json, COALESCE(s.revision, 0) AS settings_revision ' +
    'FROM users u LEFT JOIN player_profiles p ON p.user_id = u.id ' +
    'LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?',
    [userId]
  );
  return row ? { ...row, settings_revision: Number(row.settings_revision), preferences_json: readJson(row.preferences_json, {}) } : null;
}

export async function signIn(auth, suggestedName) {
  return transaction(async (db) => {
    const publicId = randomUUID();
    const preferredName = typeof suggestedName === 'string' &&
      /^[\p{L}\p{N}_. -]{3,32}$/u.test(suggestedName) ? suggestedName : null;

    await db.query(
      'INSERT INTO users (public_id, identity_hash, cognito_issuer, cognito_sub, email, username) ' +
      'VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
      [publicId, auth.identityHash, auth.issuer, auth.sub, auth.email, preferredName]
    );
    let [[user]] = await db.query('SELECT id, status FROM users WHERE identity_hash = ? FOR UPDATE', [auth.identityHash]);
    if (!user) {
      // A suggested pseudo may already belong to another account.
      await db.query(
        'INSERT INTO users (public_id, identity_hash, cognito_issuer, cognito_sub, email) VALUES (?, ?, ?, ?, ?)',
        [publicId, auth.identityHash, auth.issuer, auth.sub, auth.email]
      );
      [[user]] = await db.query('SELECT id, status FROM users WHERE public_id = ?', [publicId]);
    }

    if (user.status !== 'active') throw new HttpError(403, 'Ce compte est désactivé');
    await db.query(
      'INSERT INTO user_active_sessions (user_id, session_hash, expires_at) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE session_hash = ?, expires_at = ?',
      [user.id, auth.sessionHash, auth.expiresAt, auth.sessionHash, auth.expiresAt]
    );
    return loadProfile(user.id, db);
  });
}

export async function signOut(auth) {
  await pool.query(
    'DELETE s FROM user_active_sessions s JOIN users u ON u.id = s.user_id ' +
    'WHERE u.identity_hash = ? AND s.session_hash = ?',
    [auth.identityHash, auth.sessionHash]
  );
}

export async function patchSettings(db, userId, preferences, expectedRevision) {
  await db.query(
    'INSERT INTO user_settings (user_id, preferences_json) VALUES (?, JSON_OBJECT()) ON DUPLICATE KEY UPDATE user_id = user_id',
    [userId]
  );
  const [[row]] = await db.query('SELECT * FROM user_settings WHERE user_id = ? FOR UPDATE', [userId]);
  if (expectedRevision != null && Number(row.revision) !== expectedRevision) {
    throw new HttpError(409, 'Les réglages ont changé. Rechargez-les avant de réessayer.');
  }
  const before = readJson(row.preferences_json, {});
  const merged = { ...before, ...preferences };
  if (preferences.vibrations) merged.vibrations = { ...before.vibrations, ...preferences.vibrations };
  const revision = Number(row.revision) + 1;
  await db.query(
    'UPDATE user_settings SET preferences_json = ?, revision = ? WHERE user_id = ?',
    [JSON.stringify(merged), revision, userId]
  );
  return { preferences: merged, revision };
}

export async function saveProfile(userId, payload) {
  return transaction(async (db) => {
    if (payload.username) await db.query('UPDATE users SET username = ? WHERE id = ?', [payload.username, userId]);
    const profile = Object.fromEntries(
      ['display_name', 'avatar_url', 'bio', 'region'].filter((key) => key in payload).map((key) => [key, payload[key] || null])
    );
    if (Object.keys(profile).length) {
      await db.query('INSERT INTO player_profiles (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId]);
      const columns = Object.keys(profile).map((key) => key + ' = ?').join(', ');
      await db.query('UPDATE player_profiles SET ' + columns + ' WHERE user_id = ?', [...Object.values(profile), userId]);
    }
    if (payload.preferences_json) await patchSettings(db, userId, payload.preferences_json);
    return loadProfile(userId, db);
  });
}

export async function decommission(userId) {
  await transaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    await db.query(
      'UPDATE users SET cognito_issuer = NULL, cognito_sub = NULL, username = NULL, email = NULL, status = ? WHERE id = ?',
      ['deleted', userId]
    );
    for (const table of [
      'player_profiles', 'user_active_sessions', 'signaling_tickets', 'user_settings', 'lobby_presets',
      'player_bonus_unlocks', 'xp_events', 'player_stats',
    ]) {
      await db.query('DELETE FROM ' + table + ' WHERE user_id = ?', [userId]);
    }
    await db.query('DELETE FROM friendships WHERE user_low_id = ? OR user_high_id = ?', [userId, userId]);
    await db.query('DELETE FROM blocked_users WHERE blocker_id = ? OR blocked_id = ?', [userId, userId]);
  });
}
