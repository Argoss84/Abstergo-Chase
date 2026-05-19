import { HttpError } from '../../utils/http-error.js';
import {
  appendGameEvent,
  applyProgressionFromResult,
  createOrUpdateGame,
  getGameByCode,
  getGameWithDetails,
  insertAuditLog,
  listRecentGames,
  setGameStatus,
  upsertGamePlayer,
  upsertGamePlayerResult,
  upsertGameResult,
} from './games.repository.js';

export async function ensureGame(gameCode) {
  const game = await getGameByCode(gameCode);
  if (!game) {
    throw new HttpError(404, 'Game introuvable');
  }
  return game;
}

export async function createGame(payload) {
  return createOrUpdateGame({
    gameCode: payload.game_code,
    hostUserId: payload.host_user_id ?? null,
    hostPlayerId: payload.host_player_id ?? null,
    configJson: payload.config_json ?? null,
  });
}

export async function startGame(gameCode) {
  const updated = await setGameStatus({ gameCode, status: 'running' });
  if (!updated) throw new HttpError(404, 'Game introuvable');
  await appendGameEvent({
    gameId: updated.id,
    eventType: 'game:started',
    payloadJson: { code: updated.code },
  });
  return updated;
}

export async function endGame(gameCode, payload) {
  const updated = await setGameStatus({
    gameCode,
    status: 'ended',
    winnerSide: payload.winner_side ?? null,
    endReason: payload.end_reason ?? null,
  });
  if (!updated) throw new HttpError(404, 'Game introuvable');
  await appendGameEvent({
    gameId: updated.id,
    eventType: 'game:ended',
    payloadJson: {
      winner_side: payload.winner_side ?? null,
      end_reason: payload.end_reason ?? null,
    },
  });
  return updated;
}

export async function finalizeGameWithResults(gameCode, payload) {
  const game = await ensureGame(gameCode);
  if (game.status !== 'ended') {
    await setGameStatus({
      gameCode,
      status: 'ended',
      winnerSide: payload.winning_side ?? null,
      endReason: payload.end_reason ?? null,
    });
  }

  const result = await upsertGameResult({
    gameId: game.id,
    winningSide: payload.winning_side ?? null,
    endReason: payload.end_reason ?? null,
    durationSeconds: payload.duration_seconds ?? null,
    summaryJson: payload.summary_json ?? null,
  });

  for (const playerResult of payload.player_results) {
    const saved = await upsertGamePlayerResult({
      gameId: game.id,
      playerExternalId: playerResult.player_external_id,
      displayNameSnapshot: playerResult.display_name_snapshot,
      userId: playerResult.user_id ?? null,
      role: playerResult.role ?? null,
      team: playerResult.team ?? null,
      score: playerResult.score ?? 0,
      kills: playerResult.kills ?? 0,
      deaths: playerResult.deaths ?? 0,
      objectivesCompleted: playerResult.objectives_completed ?? 0,
      rewardXp: playerResult.reward_xp ?? 0,
      isWinner: playerResult.is_winner ?? false,
    });
    await applyProgressionFromResult({
      userId: saved.user_id,
      rewardXp: saved.reward_xp,
      isWinner: saved.is_winner,
    });
    await insertAuditLog({
      actorUserId: null,
      targetUserId: saved.user_id,
      action: 'game:result-applied',
      payloadJson: {
        game_code: gameCode,
        reward_xp: saved.reward_xp,
        is_winner: saved.is_winner,
      },
    });
  }

  await appendGameEvent({
    gameId: game.id,
    eventType: 'game:results-finalized',
    payloadJson: {
      winning_side: payload.winning_side ?? null,
      players: payload.player_results.length,
    },
  });

  return { gameCode, result };
}

export async function upsertGameParticipant(gameCode, payload) {
  const game = await ensureGame(gameCode);
  const participant = await upsertGamePlayer({
    gameId: game.id,
    playerExternalId: payload.player_external_id,
    displayNameSnapshot: payload.display_name_snapshot,
    userId: payload.user_id ?? null,
    role: payload.role ?? null,
    team: payload.team ?? null,
    isHost: payload.is_host ?? false,
    status: payload.status ?? 'active',
  });
  await appendGameEvent({
    gameId: game.id,
    eventType: 'game:player-upserted',
    actorUserId: payload.user_id ?? null,
    actorExternalId: payload.player_external_id,
    payloadJson: {
      role: payload.role ?? null,
      team: payload.team ?? null,
      status: payload.status ?? 'active',
    },
  });
  return participant;
}

export async function appendEvents(gameCode, events) {
  const game = await ensureGame(gameCode);
  const inserted = [];
  for (const event of events) {
    inserted.push(
      await appendGameEvent({
        gameId: game.id,
        eventType: event.event_type,
        actorUserId: event.actor_user_id ?? null,
        actorExternalId: event.actor_external_id ?? null,
        payloadJson: event.payload_json ?? null,
        createdAt: event.created_at ?? null,
      })
    );
  }
  return inserted;
}

export async function fetchGame(gameCode) {
  const details = await getGameWithDetails(gameCode);
  if (!details) throw new HttpError(404, 'Game introuvable');
  return details;
}

export async function fetchRecentGames(limit = 30) {
  return listRecentGames(limit);
}
