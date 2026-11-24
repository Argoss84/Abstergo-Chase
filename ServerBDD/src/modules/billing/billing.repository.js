import { env } from '../../config/env.js';
import { pool, readJson, transaction } from '../../db/pool.js';
import { hash } from '../../middleware/auth-cognito.js';
import { HttpError } from '../../utils/http-error.js';
import { acknowledgePurchase, fetchPurchase, isPlayConfigured } from './play-client.js';

const activeStates = [
  'SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED',
];

export async function config(db, key, version = null) {
  const [[row]] = await db.query(
    'SELECT version, value_json FROM app_config_versions WHERE config_key = ? ' +
    (version == null ? 'ORDER BY version DESC LIMIT 1' : 'AND version = ?'),
    version == null ? [key] : [key, version]
  );
  return { version: row?.version ?? null, values: readJson(row?.value_json, {}) };
}

export async function featuresFor(db, userId) {
  const [rows] = await db.query(
    'SELECT DISTINCT f.feature_code FROM play_subscriptions s ' +
    'JOIN play_subscription_items i ON i.purchase_hash = s.purchase_hash ' +
    'JOIN play_plan_features f ON f.plan_id = i.plan_id WHERE s.user_id = ? AND s.superseded_by IS NULL ' +
    'AND s.play_state IN (?) AND i.expires_at > UTC_TIMESTAMP(3)',
    [userId, activeStates]
  );
  return rows.map((row) => row.feature_code);
}

export async function billingStatus(userId, publicId) {
  const { values } = await config(pool, 'hosting');
  const features = await featuresFor(pool, userId);
  return {
    features,
    obfuscated_account_id: publicId,
    product_id: isPlayConfigured() ? env.play.productId : null,
    base_plan_id: isPlayConfigured() ? env.play.basePlanId : null,
    daily_round_limit: features.includes('more_hosted_rounds') ? values.premium_daily_rounds : values.free_daily_rounds,
    premium_settings: values.premium_settings ?? {},
  };
}

export async function enforceHosting(db, userId, gameConfig) {
  const setting = await config(db, 'hosting');
  const features = await featuresFor(db, userId);
  const limit = features.includes('more_hosted_rounds') ? setting.values.premium_daily_rounds : setting.values.free_daily_rounds;
  if (Number.isInteger(limit) && limit >= 0) {
    const [[row]] = await db.query(
      'SELECT COUNT(*) AS used FROM games WHERE host_user_id = ? AND started_at >= UTC_DATE()',
      [userId]
    );
    if (Number(row.used) >= limit) throw new HttpError(403, 'Limite de parties créées atteinte pour aujourd’hui');
  }
  for (const [key, policy] of Object.entries(setting.values.premium_settings ?? {})) {
    const value = gameConfig[key];
    const feature = policy.feature ?? 'advanced_lobby_settings';
    if (value == null || features.includes(feature)) continue;
    const allowed = Array.isArray(policy.free_values)
      ? policy.free_values.includes(value)
      : typeof value === 'number' && typeof policy.free_max === 'number' && value <= policy.free_max;
    if (!allowed) throw new HttpError(403, 'Ce réglage de salon nécessite un abonnement');
  }
  return setting.version;
}

async function savePurchase(db, purchase, purchaseHash, observedAt, requester) {
  const [[previous]] = await db.query('SELECT * FROM play_subscriptions WHERE purchase_hash = ? FOR UPDATE', [purchaseHash]);
  const linkedHash = purchase.linkedPurchaseToken ? hash(purchase.linkedPurchaseToken) : null;
  const [[linked]] = linkedHash
    ? await db.query('SELECT user_id FROM play_subscriptions WHERE purchase_hash = ?', [linkedHash])
    : [[]];

  const ownerId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  const [[account]] = ownerId
    ? await db.query('SELECT id FROM users WHERE public_id = ? AND status = ?', [ownerId, 'active'])
    : [[]];
  const userId = previous?.user_id ?? linked?.user_id ?? account?.id;
  if (!userId) {
    if (!requester) return null;
    throw new HttpError(422, 'L’achat doit être effectué depuis ton compte de jeu');
  }
  if ((requester && requester.userId !== userId) ||
      (account && account.id !== userId) || (linked && linked.user_id !== userId)) {
    throw new HttpError(409, 'Cet abonnement est rattaché à un autre compte');
  }
  if (previous && previous.verified_at > observedAt) return null;

  const items = [];
  for (const item of purchase.lineItems ?? []) {
    const expiry = new Date(item.expiryTime ?? '');
    if (!Number.isFinite(expiry.getTime())) continue;
    const basePlan = item.offerDetails?.basePlanId;
    if (item.productId === env.play.productId && basePlan === env.play.basePlanId) {
      await db.query(
        'INSERT INTO play_plans (product_id, base_plan_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = id',
        [item.productId, basePlan]
      );
      const [[plan]] = await db.query('SELECT id FROM play_plans WHERE product_id = ? AND base_plan_id = ?', [item.productId, basePlan]);
      await db.query(
        "INSERT IGNORE INTO play_plan_features (plan_id, feature_code) VALUES (?, 'ads_free'), (?, 'more_hosted_rounds'), (?, 'advanced_lobby_settings')",
        [plan.id, plan.id, plan.id]
      );
    }
    if (!basePlan) continue;
    const [[plan]] = await db.query('SELECT id FROM play_plans WHERE product_id = ? AND base_plan_id = ?', [item.productId, basePlan]);
    if (plan) items.push({ planId: plan.id, productId: item.productId, expiry });
  }
  if (!items.length && !previous && requester && purchase.subscriptionState !== 'SUBSCRIPTION_STATE_PENDING') {
    throw new HttpError(422, 'Offre Google Play inconnue');
  }
  const state = purchase.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED';
  const acknowledged = purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  await db.query(
    'INSERT INTO play_subscriptions (purchase_hash, user_id, play_state, acknowledged, verified_at) VALUES (?, ?, ?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE play_state = ?, acknowledged = ?, verified_at = ?',
    [purchaseHash, userId, state, acknowledged, observedAt, state, acknowledged, observedAt]
  );
  await db.query('DELETE FROM play_subscription_items WHERE purchase_hash = ?', [purchaseHash]);
  for (const { planId, expiry } of items) {
    await db.query(
      'INSERT INTO play_subscription_items (purchase_hash, plan_id, expires_at) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE expires_at = GREATEST(expires_at, ?)',
      [purchaseHash, planId, expiry, expiry]
    );
  }
  const activeItem = activeStates.includes(state) && items.find((item) => item.expiry > observedAt);
  if (linkedHash && linkedHash !== purchaseHash && activeItem) {
    await db.query('UPDATE play_subscriptions SET superseded_by = ? WHERE purchase_hash = ? AND user_id = ?',
      [purchaseHash, linkedHash, userId]);
  }
  return !acknowledged && activeItem ? activeItem.productId : null;
}

export async function verifySubscription(token, requester, notification = null) {
  const purchaseHash = hash(token);
  if (notification) {
    const [records] = await pool.query('SELECT 1 FROM play_billing_events WHERE message_id = ?', [notification.id]);
    if (records.length) return;
  }
  const observedAt = new Date();
  let purchase;
  try {
    purchase = await fetchPurchase(token);
  } catch (error) {
    if (!notification || error.status !== 422) throw error;
    await pool.query(
      "UPDATE play_subscriptions SET play_state = 'SUBSCRIPTION_STATE_EXPIRED', verified_at = ? WHERE purchase_hash = ? AND verified_at <= ?",
      [observedAt, purchaseHash, observedAt]
    );
    purchase = null;
  }
  if (purchase) {
    const product = await transaction((db) => savePurchase(db, purchase, purchaseHash, observedAt, requester));
    if (product) {
      await acknowledgePurchase(product, token);
      await pool.query('UPDATE play_subscriptions SET acknowledged = 1 WHERE purchase_hash = ?', [purchaseHash]);
    }
  }
  if (notification) {
    await pool.query(
      'INSERT IGNORE INTO play_billing_events (message_id, purchase_hash, event_type) VALUES (?, ?, ?)',
      [notification.id, purchaseHash, notification.type]
    );
  }
}
