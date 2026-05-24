// ============================================================
// Kago AI – Realtime Event Service
//
// Publishes events from triggers/services to a per-subreddit
// Devvit realtime channel. The dashboard custom post subscribes
// via useChannel and pushes live updates to the webview without
// requiring polling.
//
// All publish operations are best-effort: realtime failures
// never block moderation actions.
// ============================================================

import type { Context } from '@devvit/public-api';
import type { FlaggedItem } from '../types.js';

// ──────────────────────────────────────────────
// Channel naming
// ──────────────────────────────────────────────

/**
 * Channel name is deterministic per subreddit so the dashboard
 * custom post and trigger handlers agree without coordination.
 */
export function kagoChannel(subredditId: string): string {
  return `kago_events_${subredditId}`;
}

// ──────────────────────────────────────────────
// Event payload shapes (must be JSON-serializable)
// ──────────────────────────────────────────────

export interface QueueAddedEvent {
  type: 'queue:added';
  timestamp: number;
  item: FlaggedItem;
}

export interface QueueResolvedEvent {
  type: 'queue:resolved';
  timestamp: number;
  itemId: string;
  resolvedBy: string;
  status: string;
}

export interface AutoActionEvent {
  type: 'auto:action';
  timestamp: number;
  itemId: string;
  contentType: 'post' | 'comment';
  action: 'auto_remove' | 'auto_approve' | 'auto_ban_temp';
  category: string;
  confidence: number;
  authorName: string;
  reason: string;
}

export interface RaidAlertEvent {
  type: 'raid:alert';
  timestamp: number;
  severity: 'critical' | 'high' | 'medium';
  itemCount: number;
  uniqueAuthors: number;
}

export interface ModOverrideEvent {
  type: 'mod:override';
  timestamp: number;
  itemId: string;
  modUsername: string;
  modAction: string;
  originalCategory: string;
}

export type KagoEvent =
  | QueueAddedEvent
  | QueueResolvedEvent
  | AutoActionEvent
  | RaidAlertEvent
  | ModOverrideEvent;

// ──────────────────────────────────────────────
// Publish helpers
// ──────────────────────────────────────────────

/**
 * Best-effort publish. Never throws — realtime is a UX enhancement,
 * not a correctness requirement. If the realtime plugin is unavailable
 * or temporarily failing, moderation actions still proceed normally.
 */
export async function publishEvent(
  context: Pick<Context, 'realtime'>,
  subredditId: string,
  event: KagoEvent,
): Promise<void> {
  try {
    if (!context.realtime) return;
    // JSON.parse(JSON.stringify(...)) strips any non-JSON values
    // (functions, undefined, Date objects) before transmission.
    const safe = JSON.parse(JSON.stringify(event));
    await context.realtime.send(kagoChannel(subredditId), safe);
  } catch (err) {
    console.warn('[Kago/realtime] Publish failed (non-fatal):', err);
  }
}

export function makeQueueAddedEvent(item: FlaggedItem): QueueAddedEvent {
  return { type: 'queue:added', timestamp: Date.now(), item };
}

export function makeAutoActionEvent(
  itemId: string,
  contentType: 'post' | 'comment',
  action: 'auto_remove' | 'auto_approve' | 'auto_ban_temp',
  category: string,
  confidence: number,
  authorName: string,
  reason: string,
): AutoActionEvent {
  return {
    type: 'auto:action',
    timestamp: Date.now(),
    itemId, contentType, action, category, confidence, authorName, reason,
  };
}

export function makeQueueResolvedEvent(
  itemId: string,
  resolvedBy: string,
  status: string,
): QueueResolvedEvent {
  return { type: 'queue:resolved', timestamp: Date.now(), itemId, resolvedBy, status };
}

export function makeModOverrideEvent(
  itemId: string,
  modUsername: string,
  modAction: string,
  originalCategory: string,
): ModOverrideEvent {
  return {
    type: 'mod:override',
    timestamp: Date.now(),
    itemId, modUsername, modAction, originalCategory,
  };
}
