// ============================================================
// Sentinel AI – Metrics Service
// Tracks moderation statistics per subreddit in Redis.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { SentinelMetrics, DerivedStats, ViolationCategory } from '../types.js';
import { Keys } from '../constants.js';

// ──────────────────────────────────────────────
// Serialization
// ──────────────────────────────────────────────

function serializeMetrics(m: SentinelMetrics): Record<string, string> {
  return {
    subredditId: m.subredditId,
    totalScanned: String(m.totalScanned),
    autoRemoved: String(m.autoRemoved),
    autoApproved: String(m.autoApproved),
    autoBanned: String(m.autoBanned),
    manuallyApproved: String(m.manuallyApproved),
    manuallyRemoved: String(m.manuallyRemoved),
    falsePositives: String(m.falsePositives),
    falseNegatives: String(m.falseNegatives),
    spamCount: String(m.spamCount),
    toxicityCount: String(m.toxicityCount),
    ruleViolationCount: String(m.ruleViolationCount),
    lowEffortCount: String(m.lowEffortCount),
    scamCount: String(m.scamCount),
    hateSpeechCount: String(m.hateSpeechCount),
    selfPromotionCount: String(m.selfPromotionCount),
    nsfwCount: String(m.nsfwCount),
    brigadingCount: String(m.brigadingCount),
    manipulationCount: String(m.manipulationCount),
    cleanCount: String(m.cleanCount),
    avgProcessingTimeMs: String(m.avgProcessingTimeMs),
    processingTimeSamples: String(m.processingTimeSamples),
    lastReset: String(m.lastReset),
    lastUpdated: String(m.lastUpdated),
  };
}

function deserializeMetrics(data: Record<string, string>, subredditId: string): SentinelMetrics {
  const p = (k: string, d = '0') => parseInt(data[k] ?? d, 10);
  return {
    subredditId,
    totalScanned: p('totalScanned'),
    autoRemoved: p('autoRemoved'),
    autoApproved: p('autoApproved'),
    autoBanned: p('autoBanned'),
    manuallyApproved: p('manuallyApproved'),
    manuallyRemoved: p('manuallyRemoved'),
    falsePositives: p('falsePositives'),
    falseNegatives: p('falseNegatives'),
    spamCount: p('spamCount'),
    toxicityCount: p('toxicityCount'),
    ruleViolationCount: p('ruleViolationCount'),
    lowEffortCount: p('lowEffortCount'),
    scamCount: p('scamCount'),
    hateSpeechCount: p('hateSpeechCount'),
    selfPromotionCount: p('selfPromotionCount'),
    nsfwCount: p('nsfwCount'),
    brigadingCount: p('brigadingCount'),
    manipulationCount: p('manipulationCount'),
    cleanCount: p('cleanCount'),
    avgProcessingTimeMs: p('avgProcessingTimeMs'),
    processingTimeSamples: p('processingTimeSamples'),
    lastReset: p('lastReset', String(Date.now())),
    lastUpdated: p('lastUpdated', String(Date.now())),
  };
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

async function getOrCreate(redis: RedisClient, subredditId: string): Promise<SentinelMetrics> {
  const data = await redis.hGetAll(Keys.metrics(subredditId));
  if (data && Object.keys(data).length > 0) {
    return deserializeMetrics(data as Record<string, string>, subredditId);
  }
  const fresh: SentinelMetrics = {
    subredditId,
    totalScanned: 0, autoRemoved: 0, autoApproved: 0, autoBanned: 0,
    manuallyApproved: 0, manuallyRemoved: 0,
    falsePositives: 0, falseNegatives: 0,
    spamCount: 0, toxicityCount: 0, ruleViolationCount: 0, lowEffortCount: 0,
    scamCount: 0, hateSpeechCount: 0, selfPromotionCount: 0, nsfwCount: 0,
    brigadingCount: 0, manipulationCount: 0, cleanCount: 0,
    avgProcessingTimeMs: 0, processingTimeSamples: 0,
    lastReset: Date.now(), lastUpdated: Date.now(),
  };
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(fresh));
  return fresh;
}

/** Increment total scanned and the appropriate violation counter. */
export async function recordScan(
  redis: RedisClient,
  subredditId: string,
  category: ViolationCategory,
): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.totalScanned += 1;
  m.lastUpdated = Date.now();

  const catMap: Partial<Record<ViolationCategory, keyof SentinelMetrics>> = {
    spam: 'spamCount',
    toxicity: 'toxicityCount',
    rule_violation: 'ruleViolationCount',
    low_effort: 'lowEffortCount',
    scam: 'scamCount',
    hate_speech: 'hateSpeechCount',
    self_promotion: 'selfPromotionCount',
    nsfw: 'nsfwCount',
    brigading: 'brigadingCount',
    manipulation: 'manipulationCount',
    clean: 'cleanCount',
  };

  const field = catMap[category];
  if (field) {
    (m as unknown as Record<string, number>)[field] = ((m as unknown as Record<string, number>)[field] || 0) + 1;
  }

  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record an auto-removal. */
export async function recordAutoRemoval(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.autoRemoved += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record an auto-approval (trusted user bypass). */
export async function recordAutoApproval(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.autoApproved += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record a manual moderator approval. */
export async function recordManualApproval(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.manuallyApproved += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record a manual moderator removal. */
export async function recordManualRemoval(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.manuallyRemoved += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record a false positive (mod approved something Sentinel wanted to remove). */
export async function recordFalsePositive(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.falsePositives += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Fetch all metrics for a subreddit. */
export async function getMetrics(
  redis: RedisClient,
  subredditId: string,
): Promise<SentinelMetrics> {
  return getOrCreate(redis, subredditId);
}

/** Compute derived stats for display. */
export function computeDerivedStats(m: SentinelMetrics): DerivedStats {
  const autoHandled = m.autoRemoved + m.autoApproved + m.autoBanned;
  const autoModRate = m.totalScanned > 0 ? Math.round((autoHandled / m.totalScanned) * 100) : 0;
  const timeSavedHours = parseFloat(((autoHandled * 2) / 60).toFixed(1));
  const flaggedCount = m.totalScanned - m.cleanCount;
  const falsePositiveRate =
    flaggedCount > 0 ? Math.round((m.falsePositives / flaggedCount) * 100) : 0;
  const queueReductionEst = Math.round(autoModRate * 0.85);

  // Average response time in seconds
  const avgResponseTimeSec = m.processingTimeSamples > 0
    ? parseFloat((m.avgProcessingTimeMs / 1000).toFixed(2))
    : 0;

  // Moderator efficiency: ratio of total actions to manual actions (higher = less mod work)
  const totalActions = autoHandled + m.manuallyApproved + m.manuallyRemoved;
  const moderatorEfficiencyScore = totalActions > 0
    ? Math.round((autoHandled / totalActions) * 100)
    : 0;

  // Time saved today estimate
  const todayHours = parseFloat(((autoHandled * 2) / 60).toFixed(1));
  const timeSavedToday = todayHours < 1 ? `${Math.round(todayHours * 60)}m` : `${todayHours}h`;

  return {
    autoModRate,
    timeSavedHours,
    falsePositiveRate,
    queueReductionEst,
    avgResponseTimeSec,
    moderatorEfficiencyScore,
    timeSavedToday,
  };
}

/** Record a processing time sample to track average response time. */
export async function recordProcessingTime(
  redis: RedisClient,
  subredditId: string,
  timeMs: number,
): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  const totalSamples = m.processingTimeSamples + 1;
  // Running average
  m.avgProcessingTimeMs = Math.round(
    ((m.avgProcessingTimeMs * m.processingTimeSamples) + timeMs) / totalSamples
  );
  m.processingTimeSamples = totalSamples;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}

/** Record an auto-ban action. */
export async function recordAutoBan(redis: RedisClient, subredditId: string): Promise<void> {
  const m = await getOrCreate(redis, subredditId);
  m.autoBanned += 1;
  m.lastUpdated = Date.now();
  await redis.hSet(Keys.metrics(subredditId), serializeMetrics(m));
}
