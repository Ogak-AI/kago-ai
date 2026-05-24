// ============================================================
// Kago AI – Queue Service
// Manages the priority-sorted mod queue in Redis.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type {
  AIAnalysisResult,
  FlaggedItem,
  ItemStatus,
  PriorityLevel,
  Severity,
} from '../types.js';
import {
  HIGH_PRIORITY_THRESHOLD,
  Keys,
  MAX_BODY_STORED,
  MAX_QUEUE_SIZE,
  MEDIUM_PRIORITY_THRESHOLD,
  PRIORITY_WEIGHTS,
  PROCESSED_TTL_SECONDS,
  QUEUE_ITEM_TTL_MS,
  SEVERITY_SCORES,
} from '../constants.js';


// ──────────────────────────────────────────────
// Priority Score Computation
// ──────────────────────────────────────────────

/**
 * Compute composite priority score (0–100) per spec formula:
 *   (severityScore * 0.5) + (reportCount * 10 capped at 100 * 0.3) + ((100-trust) * 0.2)
 */
export function computePriorityScore(
  severity: Severity,
  reportCount: number,
  trustScore: number,
): number {
  const severityScore = SEVERITY_SCORES[severity] ?? 30;
  const severityComponent = severityScore * PRIORITY_WEIGHTS.SEVERITY;

  // reportCount * 10 gives a 0-100 scale (capped at 10 reports)
  const cappedReports = Math.min(reportCount, 10);
  const reportComponent = (cappedReports * 10) * PRIORITY_WEIGHTS.REPORT_COUNT;

  const riskScore = 100 - trustScore;
  const riskComponent = riskScore * PRIORITY_WEIGHTS.USER_RISK;

  const raw = severityComponent + reportComponent + riskComponent;
  return Math.max(0, Math.min(100, Math.round(raw)));
}


export function getPriorityLevel(score: number): PriorityLevel {
  if (score >= HIGH_PRIORITY_THRESHOLD) return 'high';
  if (score >= MEDIUM_PRIORITY_THRESHOLD) return 'medium';
  return 'low';
}

// ──────────────────────────────────────────────
// Serialization
// ──────────────────────────────────────────────

function serializeItem(item: FlaggedItem): Record<string, string> {
  return {
    id: item.id,
    type: item.type,
    title: item.title ?? '',
    body: item.body.slice(0, MAX_BODY_STORED),
    authorName: item.authorName,
    authorId: item.authorId,
    permalink: item.permalink,
    subredditId: item.subredditId,
    subredditName: item.subredditName,
    createdAt: String(item.createdAt),
    category: item.category,
    confidence: String(item.confidence),
    severity: item.severity,
    explanation: item.explanation,
    suggestedAction: item.suggestedAction,
    analysisSource: item.analysisSource,
    decisionReason: item.decisionReason ?? '',
    triggeredRule: item.triggeredRule ?? '',
    priorityScore: String(item.priorityScore),
    priorityLevel: item.priorityLevel,
    status: item.status,
    resolvedBy: item.resolvedBy ?? '',
    resolvedAt: String(item.resolvedAt ?? ''),
    resolution: item.resolution ?? '',
  };
}


function deserializeItem(data: Record<string, string>): FlaggedItem {
  return {
    id: data.id,
    type: data.type as FlaggedItem['type'],
    title: data.title || undefined,
    body: data.body,
    authorName: data.authorName,
    authorId: data.authorId,
    permalink: data.permalink,
    subredditId: data.subredditId,
    subredditName: data.subredditName,
    createdAt: parseInt(data.createdAt, 10),
    category: data.category as FlaggedItem['category'],
    confidence: parseFloat(data.confidence),
    severity: (data.severity as FlaggedItem['severity']) ?? 'low',
    explanation: data.explanation,
    suggestedAction: data.suggestedAction as FlaggedItem['suggestedAction'],
    analysisSource: data.analysisSource as FlaggedItem['analysisSource'],
    decisionReason: data.decisionReason || undefined,
    triggeredRule: data.triggeredRule || undefined,
    priorityScore: parseFloat(data.priorityScore),
    priorityLevel: data.priorityLevel as PriorityLevel,
    status: data.status as ItemStatus,
    resolvedBy: data.resolvedBy || undefined,
    resolvedAt: data.resolvedAt ? parseInt(data.resolvedAt, 10) : undefined,
    resolution: data.resolution || undefined,
  };
}


// ──────────────────────────────────────────────
// Deduplication
// ──────────────────────────────────────────────

/**
 * Returns true if this item has already been processed (dedup guard).
 */
export async function isAlreadyProcessed(
  redis: RedisClient,
  itemId: string,
): Promise<boolean> {
  const val = await redis.get(Keys.processed(itemId));
  return val === '1';
}

/**
 * Mark item as processed. Expires after 24 hours.
 */
export async function markProcessed(
  redis: RedisClient,
  itemId: string,
): Promise<void> {
  await redis.set(Keys.processed(itemId), '1', {
    expiration: new Date(Date.now() + PROCESSED_TTL_SECONDS * 1000),
  });
}

// ──────────────────────────────────────────────
// Queue CRUD
// ──────────────────────────────────────────────

/**
 * Add a flagged item to the priority queue.
 */
export async function enqueueItem(
  redis: RedisClient,
  subredditId: string,
  analysis: AIAnalysisResult,
  contentMeta: {
    id: string;
    type: 'post' | 'comment';
    title?: string;
    body: string;
    authorName: string;
    authorId: string;
    permalink: string;
    subredditName: string;
    createdAt: number;
    reportCount?: number;
    trustScore?: number;
    decisionReason?: string;
    triggeredRule?: string;
  },
): Promise<FlaggedItem> {
  const severity = analysis.severity;
  const priorityScore = computePriorityScore(
    severity,
    contentMeta.reportCount ?? 0,
    contentMeta.trustScore ?? 50,
  );

  const item: FlaggedItem = {
    id: contentMeta.id,
    type: contentMeta.type,
    title: contentMeta.title,
    body: contentMeta.body.slice(0, MAX_BODY_STORED),
    authorName: contentMeta.authorName,
    authorId: contentMeta.authorId,
    permalink: contentMeta.permalink,
    subredditId,
    subredditName: contentMeta.subredditName,
    createdAt: contentMeta.createdAt,
    category: analysis.category,
    confidence: analysis.confidence,
    severity,
    explanation: analysis.explanation,
    suggestedAction: analysis.suggestedAction,
    analysisSource: analysis.source,
    decisionReason: contentMeta.decisionReason,
    triggeredRule: contentMeta.triggeredRule,
    priorityScore,
    priorityLevel: getPriorityLevel(priorityScore),
    status: 'pending',
  };

  await redis.hSet(Keys.item(contentMeta.id), serializeItem(item));
  await redis.zAdd(Keys.queue(subredditId), { score: priorityScore, member: contentMeta.id });

  const queueSize = await redis.zCard(Keys.queue(subredditId));
  if (queueSize > MAX_QUEUE_SIZE) {
    const toRemove = queueSize - MAX_QUEUE_SIZE;
    const oldest = await redis.zRange(Keys.queue(subredditId), 0, toRemove - 1, { by: 'rank' });
    if (oldest && oldest.length > 0) {
      for (const member of oldest) {
        const memberId = typeof member === 'string' ? member : (member as { member: string }).member;
        await redis.zRem(Keys.queue(subredditId), [memberId]);
      }
    }
  }

  return item;
}


/**
 * Fetch the top N items from the queue (highest priority first).
 */
export async function getQueueItems(
  redis: RedisClient,
  subredditId: string,
  limit = 50,
  statusFilter?: ItemStatus,
): Promise<FlaggedItem[]> {
  // zRange with reverse gets highest scores (highest priority) first
  const members = await redis.zRange(Keys.queue(subredditId), 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });

  if (!members || members.length === 0) return [];

  const items: FlaggedItem[] = [];
  const cutoffMs = Date.now() - QUEUE_ITEM_TTL_MS;

  for (const entry of members) {
    const memberId = typeof entry === 'string' ? entry : (entry as { member: string }).member;
    const data = await redis.hGetAll(Keys.item(memberId));
    if (!data || Object.keys(data).length === 0) continue;

    const item = deserializeItem(data as Record<string, string>);

    // Expire stale items silently
    if (item.createdAt < cutoffMs && item.status === 'pending') {
      await redis.zRem(Keys.queue(subredditId), [memberId]);
      continue;
    }

    if (statusFilter && item.status !== statusFilter) continue;
    items.push(item);
  }

  return items;
}

/**
 * Resolve a queue item (approve/remove/ban/ignore).
 */
export async function resolveQueueItem(
  redis: RedisClient,
  subredditId: string,
  itemId: string,
  status: ItemStatus,
  resolvedBy: string,
  resolution?: string,
): Promise<FlaggedItem | null> {
  const data = await redis.hGetAll(Keys.item(itemId));
  if (!data || Object.keys(data).length === 0) return null;

  const item = deserializeItem(data as Record<string, string>);
  item.status = status;
  item.resolvedBy = resolvedBy;
  item.resolvedAt = Date.now();
  item.resolution = resolution;

  await redis.hSet(Keys.item(itemId), serializeItem(item));

  // Remove from active queue (resolved items stay in hash for history)
  await redis.zRem(Keys.queue(subredditId), [itemId]);

  return item;
}

/**
 * Get a single queue item by ID.
 */
export async function getQueueItem(
  redis: RedisClient,
  itemId: string,
): Promise<FlaggedItem | null> {
  const data = await redis.hGetAll(Keys.item(itemId));
  if (!data || Object.keys(data).length === 0) return null;
  return deserializeItem(data as Record<string, string>);
}

/**
 * Get queue size broken down by priority level.
 */
export async function getQueueStats(
  redis: RedisClient,
  subredditId: string,
): Promise<{ total: number; critical: number; high: number; medium: number; low: number }> {
  const items = await getQueueItems(redis, subredditId, MAX_QUEUE_SIZE, 'pending');
  const stats: { total: number; critical: number; high: number; medium: number; low: number } = { total: items.length, critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) {
    const level = item.priorityLevel as keyof typeof stats;
    if (level in stats) stats[level]++;
  }
  return stats;
}
