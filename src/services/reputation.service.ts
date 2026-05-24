// ============================================================
// Kago AI – User Reputation Service
// Maintains per-user trust scores per subreddit in Redis.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { UserReputation } from '../types.js';
import { Keys, TRUST } from '../constants.js';

// ──────────────────────────────────────────────
// Serialization helpers
// ──────────────────────────────────────────────

function serializeRep(rep: UserReputation): Record<string, string> {
  return {
    userId: rep.userId,
    username: rep.username,
    subredditId: rep.subredditId,
    trustScore: String(rep.trustScore),
    violations: String(rep.violations),
    approvals: String(rep.approvals),
    accountAgeDays: String(rep.accountAgeDays),
    karma: String(rep.karma),
    recentViolations24h: String(rep.recentViolations24h ?? 0),
    lastViolationAt: String(rep.lastViolationAt ?? ''),
    lastUpdated: String(rep.lastUpdated),
  };
}


function deserializeRep(data: Record<string, string>): UserReputation {
  return {
    userId: data.userId ?? '',
    username: data.username ?? '',
    subredditId: data.subredditId ?? '',
    trustScore: parseFloat(data.trustScore ?? '50'),
    violations: parseInt(data.violations ?? '0', 10),
    approvals: parseInt(data.approvals ?? '0', 10),
    accountAgeDays: parseInt(data.accountAgeDays ?? '0', 10),
    karma: parseInt(data.karma ?? '0', 10),
    recentViolations24h: parseInt(data.recentViolations24h ?? '0', 10),
    lastViolationAt: data.lastViolationAt ? parseInt(data.lastViolationAt, 10) : undefined,
    lastUpdated: parseInt(data.lastUpdated ?? '0', 10),
  };
}


// ──────────────────────────────────────────────
// Core score computation
// ──────────────────────────────────────────────

/**
 * Compute a trust score from 0–100 based on reputation data.
 * Higher = more trusted.
 */
export function computeTrustScore(rep: Omit<UserReputation, 'trustScore'>): number {
  let score = TRUST.INITIAL_SCORE;

  // Violations are heavily penalised
  score += rep.violations * TRUST.VIOLATION_PENALTY;

  // Approvals slowly build trust
  score += rep.approvals * TRUST.APPROVAL_BONUS;

  // Karma bonus (0–20 points, gains from positive karma)
  const karmaBonus = Math.min(20, Math.max(0, (rep.karma / 1000) * TRUST.KARMA_BONUS_PER_1K));
  score += karmaBonus;

  // Account age bonus (0–15 points, older = more trusted)
  const ageDays = Math.max(0, rep.accountAgeDays);
  const ageBonus = Math.min(15, Math.floor(ageDays / 30) * TRUST.ACCOUNT_AGE_BONUS_PER_30D);
  score += ageBonus;

  return Math.max(TRUST.MIN_SCORE, Math.min(TRUST.MAX_SCORE, Math.round(score)));
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Get or create a user reputation record.
 */
export async function getReputation(
  redis: RedisClient,
  subredditId: string,
  userId: string,
  username: string,
  accountAgeDays = 0,
  karma = 0,
): Promise<UserReputation> {
  const key = Keys.user(subredditId, userId);
  const data = await redis.hGetAll(key);

  if (data && Object.keys(data).length > 0) {
    return deserializeRep(data as Record<string, string>);
  }

  // Create a new reputation record
  const rep: UserReputation = {
    userId,
    username,
    subredditId,
    trustScore: computeTrustScore({ userId, username, subredditId, violations: 0, approvals: 0, accountAgeDays, karma, lastUpdated: Date.now() }),
    violations: 0,
    approvals: 0,
    accountAgeDays,
    karma,
    lastUpdated: Date.now(),
  };

  await redis.hSet(key, serializeRep(rep));
  return rep;
}

/**
 * Record a violation against a user and recalculate trust score.
 */
export async function recordViolation(
  redis: RedisClient,
  subredditId: string,
  userId: string,
  username: string,
  accountAgeDays = 0,
  karma = 0,
): Promise<UserReputation> {
  const rep = await getReputation(redis, subredditId, userId, username, accountAgeDays, karma);
  rep.violations += 1;
  rep.trustScore = computeTrustScore(rep);
  rep.lastUpdated = Date.now();

  const key = Keys.user(subredditId, userId);
  await redis.hSet(key, serializeRep(rep));

  // Update risk sorted set (score = 100 - trustScore, so high risk = high score)
  await redis.zAdd(Keys.userRiskSet(subredditId), {
    score: 100 - rep.trustScore,
    member: userId,
  });

  return rep;
}

/**
 * Record a clean approval for a user and recalculate trust score.
 */
export async function recordApproval(
  redis: RedisClient,
  subredditId: string,
  userId: string,
  username: string,
  accountAgeDays = 0,
  karma = 0,
): Promise<UserReputation> {
  const rep = await getReputation(redis, subredditId, userId, username, accountAgeDays, karma);
  rep.approvals += 1;
  rep.trustScore = computeTrustScore(rep);
  rep.lastUpdated = Date.now();

  const key = Keys.user(subredditId, userId);
  await redis.hSet(key, serializeRep(rep));

  await redis.zAdd(Keys.userRiskSet(subredditId), {
    score: 100 - rep.trustScore,
    member: userId,
  });

  return rep;
}

/**
 * Get top-N highest risk users in the subreddit.
 */
export async function getTopRiskyUsers(
  redis: RedisClient,
  subredditId: string,
  limit = 20,
): Promise<UserReputation[]> {
  const riskSet = await redis.zRange(Keys.userRiskSet(subredditId), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });

  if (!riskSet || riskSet.length === 0) return [];

  const reps: UserReputation[] = [];
  for (const entry of riskSet) {
    const userId = typeof entry === 'string' ? entry : (entry as { member: string }).member;
    const data = await redis.hGetAll(Keys.user(subredditId, userId));
    if (data && Object.keys(data).length > 0) {
      reps.push(deserializeRep(data as Record<string, string>));
    }
  }
  return reps;
}
