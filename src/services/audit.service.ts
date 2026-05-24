// ============================================================
// Kago AI – Audit Log Service
// Records every moderation action for accountability & review.
// Uses Redis sorted sets (Devvit doesn't support list commands).
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { AuditEntry } from '../types.js';
import { Keys, MAX_AUDIT_LOG } from '../constants.js';


/**
 * Record a single audit log entry.
 * Stored in a sorted set keyed by timestamp for chronological retrieval.
 */
export async function recordAuditEntry(
  redis: RedisClient,
  subredditId: string,
  entry: AuditEntry,
): Promise<void> {
  const key = Keys.audit(subredditId);
  // Use timestamp + random suffix to ensure unique members
  const uniqueMember = JSON.stringify(entry) + '::' + entry.timestamp + '_' + Math.random().toString(36).slice(2, 8);
  await redis.zAdd(key, { member: uniqueMember, score: entry.timestamp });

  // Cap at MAX_AUDIT_LOG entries (remove oldest)
  const count = await redis.zCard(key);
  if (count > MAX_AUDIT_LOG) {
    await redis.zRemRangeByRank(key, 0, count - MAX_AUDIT_LOG - 1);
  }
}


/**
 * Retrieve the most recent audit log entries (newest first).
 */
export async function getAuditLog(
  redis: RedisClient,
  subredditId: string,
  limit = 50,
): Promise<AuditEntry[]> {
  const key = Keys.audit(subredditId);
  const members = await redis.zRange(key, 0, limit - 1, {
    reverse: true,
    by: 'rank',
  });

  if (!members || members.length === 0) return [];

  const entries: AuditEntry[] = [];
  for (const entry of members) {
    try {
      const raw = typeof entry === 'string' ? entry : (entry as { member: string }).member;
      // Strip the unique suffix we appended
      const jsonPart = raw.replace(/::[\d]+_[a-z0-9]+$/, '');
      const parsed = JSON.parse(jsonPart) as AuditEntry;
      entries.push(parsed);
    } catch {
      // Skip malformed entries
    }
  }

  return entries;
}


/**
 * Helper to build an AuditEntry from common action parameters.
 */
export function buildAuditEntry(
  actionType: AuditEntry['actionType'],
  contentId: string,
  contentType: 'post' | 'comment',
  contentSnippet: string,
  authorName: string,
  aiCategory: string,
  aiConfidence: number,
  triggeredBy: string,
  reason: string,
): AuditEntry {
  return {
    timestamp: Date.now(),
    actionType,
    contentId,
    contentType,
    contentSnippet: contentSnippet.slice(0, 120),
    authorName,
    aiCategory,
    aiConfidence,
    triggeredBy,
    reason,
  };
}
