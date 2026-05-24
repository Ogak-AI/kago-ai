// ============================================================
// Kago AI – ModAction Trigger
//
// Fires on every moderator action recorded to the subreddit's
// modlog. Kago uses these events to:
//
//   1. Detect human overrides of Kago auto-actions
//      (e.g. mod manually approves something Kago removed
//       = false positive signal).
//   2. Detect human actions on items Kago routed to the
//      queue but didn't auto-action (still informs learning).
//   3. Feed the adaptive thresholds engine with real moderator
//      ground-truth, not just dashboard-driven overrides.
//
// Self-actions performed by Kago itself (via the app
// account) are filtered out — those are already logged when
// they happen and would create double-counting if processed
// here as if they were human decisions.
// ============================================================

import type { ModAction } from '@devvit/protos';
import type { Context } from '@devvit/public-api';
import { Keys, MAX_OVERRIDE_LOG } from '../constants.js';
import { recordAuditEntry, buildAuditEntry } from '../services/audit.service.js';
import { getQueueItem, resolveQueueItem } from '../services/queue.service.js';
import {
  recordFalsePositive,
  recordManualApproval,
  recordManualRemoval,
} from '../services/metrics.service.js';
import {
  recordApproval,
  recordViolation,
} from '../services/reputation.service.js';
import {
  publishEvent,
  makeModOverrideEvent,
  makeQueueResolvedEvent,
} from '../services/realtime.service.js';
import type { ModOverride, ViolationCategory, ItemStatus } from '../types.js';

// ──────────────────────────────────────────────
// Action classification
// ──────────────────────────────────────────────

const APPROVE_ACTIONS = new Set([
  'approvelink',
  'approvecomment',
]);

const REMOVE_ACTIONS = new Set([
  'removelink',
  'removecomment',
  'spamlink',
  'spamcomment',
]);

type ContentTarget = {
  targetId: string;
  contentType: 'post' | 'comment';
};

function extractTarget(event: ModAction): ContentTarget | null {
  if (event.targetPost?.id) {
    return { targetId: event.targetPost.id, contentType: 'post' };
  }
  if (event.targetComment?.id) {
    return { targetId: event.targetComment.id, contentType: 'comment' };
  }
  return null;
}

function classifyAction(actionStr: string | undefined): 'approve' | 'remove' | null {
  if (!actionStr) return null;
  const lower = actionStr.toLowerCase();
  if (APPROVE_ACTIONS.has(lower)) return 'approve';
  if (REMOVE_ACTIONS.has(lower)) return 'remove';
  return null;
}

/**
 * Heuristic for "is this our own action?" — Kago's app account
 * username always starts with the app name. Reddit reports app-action
 * moderators with a username like "kago-ai" or the app's slug.
 * This is conservative: we'd rather skip a real human action than
 * accidentally count Kago as a human override.
 */
function isAppAction(moderatorName: string | undefined): boolean {
  if (!moderatorName) return true;
  const lower = moderatorName.toLowerCase();
  return (
    lower === 'automoderator' ||
    lower.startsWith('kago') ||
    lower.endsWith('-bot') ||
    lower === '[deleted]'
  );
}

// ──────────────────────────────────────────────
// Override recording
// ──────────────────────────────────────────────

async function recordOverride(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redis: any,
  subredditId: string,
  itemId: string,
  originalCategory: ViolationCategory,
  originalConfidence: number,
  modAction: ItemStatus,
  modUsername: string,
): Promise<void> {
  const override: ModOverride = {
    itemId,
    originalCategory,
    originalConfidence,
    modAction,
    modUsername,
    timestamp: Date.now(),
  };

  const key = Keys.overrides(subredditId);
  await redis.zAdd(key, { member: JSON.stringify(override), score: override.timestamp });

  const count = await redis.zCard(key);
  if (count > MAX_OVERRIDE_LOG) {
    await redis.zRemRangeByRank(key, 0, count - MAX_OVERRIDE_LOG - 1);
  }
}

// ──────────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────────

export async function handleModAction(
  event: ModAction,
  context: Context,
): Promise<void> {
  const actionKind = classifyAction(event.action);
  if (!actionKind) return;

  const target = extractTarget(event);
  if (!target) return;

  const moderatorName = event.moderator?.name;
  if (isAppAction(moderatorName)) return;

  const subredditId = event.subreddit?.id;
  if (!subredditId) return;

  const item = await getQueueItem(context.redis, target.targetId);

  const safeModName = moderatorName ?? 'unknown';

  if (!item) {
    // Manual action on unflagged content — record audit only.
    try {
      await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
        actionKind === 'approve' ? 'manual_approve' : 'manual_remove',
        target.targetId,
        target.contentType,
        '',
        event.targetUser?.name ?? '',
        'unflagged',
        0,
        `moderator:${safeModName}`,
        'Mod action on content Kago did not flag',
      ));
    } catch (err) {
      console.warn('[Kago/modaction] Audit log failed:', err);
    }
    return;
  }

  const kagoSuggested = item.suggestedAction;
  const isOverride =
    (actionKind === 'approve' && kagoSuggested !== 'approve') ||
    (actionKind === 'remove' && kagoSuggested === 'approve');

  if (actionKind === 'approve') {
    const resolved = await resolveQueueItem(
      context.redis, subredditId, item.id, 'mod_approved', safeModName,
      'Approved via Reddit modlog action',
    );
    if (resolved?.authorId) {
      await recordApproval(context.redis, subredditId, resolved.authorId, resolved.authorName);
      if (kagoSuggested === 'remove' || kagoSuggested === 'ban') {
        await recordFalsePositive(context.redis, subredditId);
      }
    }
    await recordManualApproval(context.redis, subredditId);
  } else {
    const resolved = await resolveQueueItem(
      context.redis, subredditId, item.id, 'mod_removed', safeModName,
      'Removed via Reddit modlog action',
    );
    if (resolved?.authorId) {
      await recordViolation(context.redis, subredditId, resolved.authorId, resolved.authorName);
    }
    await recordManualRemoval(context.redis, subredditId);
  }

  if (isOverride) {
    await recordOverride(
      context.redis,
      subredditId,
      item.id,
      item.category,
      item.confidence,
      actionKind === 'approve' ? 'mod_approved' : 'mod_removed',
      safeModName,
    );

    await publishEvent(context, subredditId, makeModOverrideEvent(
      item.id,
      safeModName,
      actionKind === 'approve' ? 'mod_approved' : 'mod_removed',
      item.category,
    ));
  }

  try {
    await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
      actionKind === 'approve' ? 'manual_approve' : 'manual_remove',
      item.id,
      item.type,
      item.body,
      item.authorName,
      item.category,
      item.confidence,
      `moderator:${safeModName}`,
      isOverride
        ? `Mod overrode Kago (${kagoSuggested} → ${actionKind})`
        : `Mod confirmed Kago suggestion (${actionKind})`,
    ));
  } catch (err) {
    console.warn('[Kago/modaction] Audit log failed:', err);
  }

  await publishEvent(context, subredditId, makeQueueResolvedEvent(
    item.id,
    safeModName,
    actionKind === 'approve' ? 'mod_approved' : 'mod_removed',
  ));

  console.log(
    `[Kago/modaction] ${safeModName} ${actionKind}d ${item.id} ` +
    `(category=${item.category}, override=${isOverride})`,
  );
}
