import { pool } from '../../db/pool.js';

export async function upsertFromCognito({ cognitoSub, email, username }) {
  const result = await pool.query(
    `
    INSERT INTO users (cognito_sub, email, username, status)
    VALUES ($1, $2, $3, 'active')
    ON CONFLICT (cognito_sub)
    DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      username = COALESCE(EXCLUDED.username, users.username),
      updated_at = NOW()
    RETURNING id, cognito_sub, email, username, status, created_at, updated_at
    `,
    [cognitoSub, email, username]
  );

  return result.rows[0];
}

export async function getByCognitoSub(cognitoSub) {
  const result = await pool.query(
    `
    SELECT u.id, u.cognito_sub, u.email, u.username, u.status,
           p.display_name, p.avatar_url, p.bio, p.region, p.preferences_json,
           u.created_at, u.updated_at
    FROM users u
    LEFT JOIN player_profiles p ON p.user_id = u.id
    WHERE u.cognito_sub = $1
    `,
    [cognitoSub]
  );
  return result.rows[0] ?? null;
}

export async function activateSessionIfAvailable(cognitoSub, accessTokenHash) {
  const result = await pool.query(
    `
    WITH target_user AS (
      SELECT id FROM users WHERE cognito_sub = $1
    )
    INSERT INTO user_active_sessions (user_id, access_token_hash)
    SELECT id, $2 FROM target_user
    ON CONFLICT (user_id)
    DO UPDATE SET
      access_token_hash = EXCLUDED.access_token_hash,
      updated_at = NOW()
    RETURNING user_id, updated_at
    `,
    [cognitoSub, accessTokenHash]
  );

  return result.rowCount > 0;
}

export async function listConnectedUsers() {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      s.updated_at AS last_seen_at
    FROM user_active_sessions s
    JOIN users u ON u.id = s.user_id
    ORDER BY s.updated_at DESC
    `
  );
  return result.rows;
}

export async function disconnectUserSession(userId) {
  const result = await pool.query(
    `
    DELETE FROM user_active_sessions
    WHERE user_id = $1
    RETURNING user_id
    `,
    [userId]
  );
  return result.rowCount > 0;
}

export async function disconnectSessionByCognitoSub(cognitoSub, accessTokenHash = null) {
  const result = await pool.query(
    `
    DELETE FROM user_active_sessions s
    USING users u
    WHERE u.id = s.user_id
      AND u.cognito_sub = $1
      AND ($2::text IS NULL OR s.access_token_hash = $2)
    RETURNING s.user_id
    `,
    [cognitoSub, accessTokenHash]
  );
  return result.rowCount > 0;
}

export async function upsertProfileByCognitoSub(cognitoSub, payload) {
  const user = await getByCognitoSub(cognitoSub);
  if (!user) {
    return null;
  }

  if (payload.username != null && payload.username.trim() !== '') {
    await pool.query(
      `
      UPDATE users
      SET username = $1, updated_at = NOW()
      WHERE id = $2
      `,
      [payload.username.trim(), user.id]
    );
  }

  await pool.query(
    `
    INSERT INTO player_profiles (user_id, display_name, avatar_url, bio, region, preferences_json)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    ON CONFLICT (user_id)
    DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, player_profiles.display_name),
      avatar_url = COALESCE(EXCLUDED.avatar_url, player_profiles.avatar_url),
      bio = COALESCE(EXCLUDED.bio, player_profiles.bio),
      region = COALESCE(EXCLUDED.region, player_profiles.region),
      preferences_json = COALESCE(EXCLUDED.preferences_json, player_profiles.preferences_json),
      updated_at = NOW()
    `,
    [
      user.id,
      payload.display_name ?? null,
      payload.avatar_url ?? null,
      payload.bio ?? null,
      payload.region ?? null,
      payload.preferences_json ? JSON.stringify(payload.preferences_json) : null,
    ]
  );

  return getByCognitoSub(cognitoSub);
}
