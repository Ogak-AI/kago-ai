// ============================================================
// Kago AI – Rate Limiter & Cost Tracker
//
// Prevents runaway OpenAI API costs by tracking daily usage
// and enforcing a configurable daily call limit.
// ============================================================

import type { RedisClient } from '@devvit/public-api';

// ──────────────────────────────────────────────
// Redis Keys
// ──────────────────────────────────────────────

function dailyKey(subredditId: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `kago:ratelimit:${subredditId}:${today}`;
}

function costKey(subredditId: string): string {
  return `kago:cost:${subredditId}`;
}

// ──────────────────────────────────────────────
// Default Limits
// ──────────────────────────────────────────────

/** Maximum API calls per day per subreddit (default: 2000) */
export const DEFAULT_DAILY_LIMIT = 2000;

/** Estimated cost per API call in USD (GPT-4o-mini) */
export const ESTIMATED_COST_PER_CALL = 0.00015;

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Check if we can make an API call (under daily limit).
 * Returns true if allowed, false if rate-limited.
 */
export async function canMakeApiCall(
  redis: RedisClient,
  subredditId: string,
  dailyLimit: number = DEFAULT_DAILY_LIMIT,
): Promise<boolean> {
  const key = dailyKey(subredditId);
  const current = await redis.get(key);
  const count = current ? parseInt(current, 10) : 0;
  return count < dailyLimit;
}

/**
 * Record an API call. Increments daily counter and cost tracker.
 */
export async function recordApiCall(
  redis: RedisClient,
  subredditId: string,
): Promise<void> {
  const key = dailyKey(subredditId);
  const current = await redis.get(key);
  const count = current ? parseInt(current, 10) : 0;

  // Set with TTL of 25 hours (ensures it expires after the day)
  await redis.set(key, String(count + 1), {
    expiration: new Date(Date.now() + 90000000), // 25 hours
  });

  // Track cumulative cost
  const cKey = costKey(subredditId);
  const rawCost = await redis.get(cKey);
  const totalCost = rawCost ? parseFloat(rawCost) : 0;
  await redis.set(cKey, String(totalCost + ESTIMATED_COST_PER_CALL));
}

/**
 * Get current daily usage stats.
 */
export async function getApiUsage(
  redis: RedisClient,
  subredditId: string,
): Promise<{ todayCalls: number; estimatedCostToday: string; totalCost: string }> {
  const key = dailyKey(subredditId);
  const current = await redis.get(key);
  const todayCalls = current ? parseInt(current, 10) : 0;

  const cKey = costKey(subredditId);
  const rawCost = await redis.get(cKey);
  const totalCost = rawCost ? parseFloat(rawCost) : 0;

  return {
    todayCalls,
    estimatedCostToday: '$' + (todayCalls * ESTIMATED_COST_PER_CALL).toFixed(4),
    totalCost: '$' + totalCost.toFixed(4),
  };
}
