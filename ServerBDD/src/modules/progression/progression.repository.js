import { pool } from '../../db/pool.js';

export async function unlockBonuses(db, userId) {
  await db.query(
    "INSERT INTO player_bonus_unlocks (user_id, bonus_id, remaining_charges) " +
    "SELECT u.id, b.id, IF(b.use_type = 'consumable', COALESCE(b.initial_charges, 1), NULL) FROM users u " +
    "LEFT JOIN player_stats p ON p.user_id = u.id JOIN bonuses b ON b.minimum_level <= COALESCE(p.level, 1) " +
    "WHERE u.id = ? AND u.status = 'active' AND b.enabled = 1 " +
    "ON DUPLICATE KEY UPDATE bonus_id = player_bonus_unlocks.bonus_id",
    [userId]
  );
}

export async function applyOutcome(db, player, roundKey, won, completed, winXp) {
  const [[account]] = await db.query('SELECT status FROM users WHERE id = ? FOR UPDATE', [player.user_id]);
  if (account?.status !== 'active' || !completed) return 0;
  const points = won ? winXp : 0;
  if (points) {
    await db.query(
      'INSERT INTO xp_events (user_id, game_player_id, source_key, source_type, points) VALUES (?, ?, ?, ?, ?)',
      [player.user_id, player.id, 'win:' + roundKey, 'game_win', points]
    );
  }

  await db.query(
    'INSERT INTO player_stats (user_id, xp, wins, losses) VALUES (?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE xp = xp + ?, wins = wins + ?, losses = losses + ?',
    [player.user_id, points, Number(won), Number(!won), points, Number(won), Number(!won)]
  );
  const [[stats]] = await db.query('SELECT xp FROM player_stats WHERE user_id = ?', [player.user_id]);
  const [[threshold]] = await db.query('SELECT level FROM level_thresholds WHERE required_xp <= ? ORDER BY required_xp DESC LIMIT 1', [stats.xp]);
  await db.query('UPDATE player_stats SET level = ? WHERE user_id = ?', [threshold?.level ?? 1, player.user_id]);
  await unlockBonuses(db, player.user_id);
  return points;
}

export async function getProgression(userId, db = pool) {
  const [[stats]] = await db.query(
    'SELECT level, xp, wins, losses, rank_tier FROM player_stats WHERE user_id = ?',
    [userId]
  );
  return stats ?? { level: 1, xp: 0, wins: 0, losses: 0, rank_tier: 'unranked' };
}

export async function loadout(db, userId, role) {
  const [bonuses] = await db.query(
    'SELECT b.id, b.use_type, p.remaining_charges FROM player_bonus_unlocks p JOIN bonuses b ON b.id = p.bonus_id ' +
    'WHERE p.user_id = ? AND p.equipped = 1 AND b.enabled = 1 AND (b.allowed_role IS NULL OR b.allowed_role = ?) ' +
    'AND (p.remaining_charges IS NULL OR p.remaining_charges > 0)',
    [userId, role]
  );
  return bonuses;
}
