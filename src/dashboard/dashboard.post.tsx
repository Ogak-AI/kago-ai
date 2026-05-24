// ============================================================
// Sentinel AI – Dashboard Custom Post (Devvit Blocks + Webview)
// The pinned interactive dashboard moderators use.
// ============================================================

import { Devvit } from '@devvit/public-api';
import type { Context } from '@devvit/public-api';
import type {
  ActionRequestPayload,
  BatchActionPayload,
  FlaggedItem,
  InitDataPayload,
  ModOverride,
  RulesSavePayload,
  WebviewMessage,
} from '../types.js';
import { getQueueItems, resolveQueueItem, getQueueItem } from '../services/queue.service.js';
import { getTopRiskyUsers } from '../services/reputation.service.js';
import { getMetrics, computeDerivedStats, recordManualApproval, recordManualRemoval, recordFalsePositive } from '../services/metrics.service.js';
import { recordApproval, recordViolation } from '../services/reputation.service.js';
import { loadSettings } from '../services/settings.service.js';
import { loadCustomRules, saveCustomRules } from '../services/rules.service.js';
import { recordAuditEntry, buildAuditEntry, getAuditLog } from '../services/audit.service.js';
import { computeHealthScore, getHealthScore } from '../services/health.service.js';
import { getActiveRaidAlert } from '../services/raid.service.js';
import { generateModerationSummary } from '../services/summarizer.service.js';
import { Keys, MAX_OVERRIDE_LOG } from '../constants.js';


// ──────────────────────────────────────────────
// Mod Override Recording (Adaptive Learning)
// ──────────────────────────────────────────────

async function recordModOverride(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redis: any,
  subredditId: string,
  item: FlaggedItem,
  modAction: string,
  modUsername: string,
): Promise<void> {
  const override: ModOverride = {
    itemId: item.id,
    originalCategory: item.category,
    originalConfidence: item.confidence,
    modAction: modAction as ModOverride['modAction'],
    modUsername,
    timestamp: Date.now(),
  };

  const key = Keys.overrides(subredditId);
  const score = override.timestamp;
  await redis.zAdd(key, { member: JSON.stringify(override), score });
  
  // Cap at MAX_OVERRIDE_LOG entries (remove oldest which have lowest scores)
  const count = await redis.zCard(key);
  if (count > MAX_OVERRIDE_LOG) {
    await redis.zRemRangeByRank(key, 0, count - MAX_OVERRIDE_LOG - 1);
  }
}


// ──────────────────────────────────────────────
// Data loader for dashboard
// ──────────────────────────────────────────────

async function loadDashboardData(context: Context): Promise<InitDataPayload> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const subredditId = subreddit.id;

  const currentUser = await context.reddit.getCurrentUser();
  const username = currentUser?.username ?? 'unknown';

  // Check if the current user is a mod
  let isModerator = false;
  try {
    const mods = await context.reddit.getModerators({ subredditName: subreddit.name }).all();
    isModerator = mods.some((m) => m.username === username);
  } catch {
    isModerator = false;
  }

  const [queueItems, metrics, topUsers, settings, customRules] = await Promise.all([
    getQueueItems(context.redis, subredditId, 50, 'pending'),
    getMetrics(context.redis, subredditId),
    getTopRiskyUsers(context.redis, subredditId, 20),
    loadSettings(context),
    loadCustomRules(context.redis, subredditId),
  ]);

  // Load override log for adaptive learning stats
  let overrideCount = 0;
  try {
    const overrides = await context.redis.zRange(Keys.overrides(subredditId), 0, -1, { by: 'rank' });
    overrideCount = overrides?.length ?? 0;
  } catch {
    // Not critical
  }

  // Load audit log
  const auditLog = await getAuditLog(context.redis, subredditId, 50);

  // Compute derived stats
  const derived = computeDerivedStats(metrics);

  // Health score, raid alert, moderation summary
  const [healthScore, raidAlert, moderationSummary] = await Promise.all([
    computeHealthScore(context.redis, subredditId, metrics, queueItems, topUsers),
    getActiveRaidAlert(context.redis, subredditId),
    generateModerationSummary(context.redis, subredditId, metrics, auditLog),
  ]);

  // Rate limit info
  let rateLimitInfo = undefined;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const callsStr = await context.redis.get(Keys.openaiCalls(subredditId, today));
    const todayCalls = callsStr ? parseInt(callsStr, 10) : 0;
    const costStr = await context.redis.get(Keys.cost(subredditId));
    const totalCostNum = costStr ? parseFloat(costStr) : 0;
    rateLimitInfo = {
      todayCalls,
      dailyLimit: settings.dailyApiLimit || 500,
      isRateLimited: todayCalls >= (settings.dailyApiLimit || 500),
      estimatedCostToday: '$' + (todayCalls * 0.00015).toFixed(4),
      totalCost: '$' + totalCostNum.toFixed(4),
    };
  } catch {
    // Non-critical
  }

  // AI mode status
  let aiModeStatus: 'ai_active' | 'heuristic_only' | 'rate_limited' = 'ai_active';
  if (!settings.openaiApiKey) {
    aiModeStatus = 'heuristic_only';
  } else if (rateLimitInfo?.isRateLimited) {
    aiModeStatus = 'rate_limited';
  }

  return {
    queueItems,
    metrics,
    derived,
    topUsers,
    settings: {
      autoRemoveThreshold: settings.autoRemoveThreshold,
      autoApproveTrustedUsers: settings.autoApproveTrustedUsers,
      trustedUserThreshold: settings.trustedUserThreshold,
      subredditRules: settings.subredditRules,
      enableRemovalComments: settings.enableRemovalComments,
    },
    customRules,
    isModerator,
    currentUsername: username,
    auditLog,
    rateLimitInfo,
    aiModeStatus,
    healthScore,
    raidAlert: raidAlert ?? undefined,
    moderationSummary,
  };
}



// ──────────────────────────────────────────────
// Action handler from webview
// ──────────────────────────────────────────────

async function handleAction(
  payload: ActionRequestPayload,
  context: Context,
): Promise<{ success: boolean; message: string }> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const subredditId = subreddit.id;
  const currentUser = await context.reddit.getCurrentUser();
  const modUsername = currentUser?.username ?? 'moderator';

  try {
    const { itemId, action } = payload;

    // Get the item before resolving (for override tracking)
    const originalItem = await getQueueItem(context.redis, itemId);

    switch (action) {
      case 'approve': {
        await context.reddit.approve(itemId);
        const resolved = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_approved', modUsername);
        if (resolved?.authorId) {
          if (resolved.suggestedAction === 'remove' || resolved.suggestedAction === 'ban') {
            await recordFalsePositive(context.redis, subredditId);
          }
          await recordApproval(context.redis, subredditId, resolved.authorId, resolved.authorName);
        }
        await recordManualApproval(context.redis, subredditId);

        // Record mod override for adaptive learning
        if (originalItem && originalItem.suggestedAction !== 'approve') {
          await recordModOverride(context.redis, subredditId, originalItem, 'mod_approved', modUsername);
        }

        // Audit log
        if (originalItem) {
          await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
            'manual_approve', itemId, originalItem.type, originalItem.body,
            originalItem.authorName, originalItem.category, originalItem.confidence,
            `moderator:${modUsername}`, 'Manually approved by moderator',
          ));
        }

        return { success: true, message: 'Content approved — trust score improved' };
      }

      case 'remove': {
        await context.reddit.remove(itemId, false);
        const resolved = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_removed', modUsername);
        if (resolved?.authorId) {
          await recordViolation(context.redis, subredditId, resolved.authorId, resolved.authorName);
        }
        await recordManualRemoval(context.redis, subredditId);

        // Record mod override for adaptive learning
        if (originalItem && originalItem.suggestedAction !== 'remove') {
          await recordModOverride(context.redis, subredditId, originalItem, 'mod_removed', modUsername);
        }

        // Audit log
        if (originalItem) {
          await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
            'manual_remove', itemId, originalItem.type, originalItem.body,
            originalItem.authorName, originalItem.category, originalItem.confidence,
            `moderator:${modUsername}`, 'Manually removed by moderator',
          ));
        }

        return { success: true, message: 'Content removed — trust score decreased' };
      }

      case 'ban': {
        const item = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_banned', modUsername);
        if (item?.authorName) {
          await context.reddit.banUser({
            subredditName: subreddit.name,
            username: item.authorName,
            duration: 30,
            reason: item.explanation ?? 'Violation of subreddit rules',
            message: `You have been banned for: ${item.explanation ?? 'violation of community rules'}`,
          });
          await context.reddit.remove(itemId, false);
          await recordViolation(context.redis, subredditId, item.authorId, item.authorName);
        }
        await recordManualRemoval(context.redis, subredditId);

        // Record override
        if (originalItem) {
          await recordModOverride(context.redis, subredditId, originalItem, 'mod_banned', modUsername);
          await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
            'manual_ban', itemId, originalItem.type, originalItem.body,
            originalItem.authorName, originalItem.category, originalItem.confidence,
            `moderator:${modUsername}`, 'User banned (30d) and content removed',
          ));
        }

        return { success: true, message: 'User banned (30d) & content removed' };
      }

      case 'ignore': {
        await resolveQueueItem(context.redis, subredditId, itemId, 'ignored', modUsername);
        if (originalItem) {
          await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
            'manual_ignore', itemId, originalItem.type, originalItem.body,
            originalItem.authorName, originalItem.category, originalItem.confidence,
            `moderator:${modUsername}`, 'Dismissed from queue',
          ));
        }
        return { success: true, message: 'Dismissed from queue' };
      }

      case 'lock': {
        // Fallback: Just ignore/dismiss if locking is unsupported in this API version
        await resolveQueueItem(context.redis, subredditId, itemId, 'ignored', modUsername, 'Locked/Dismissed by moderator');
        return { success: true, message: 'Content dismissed (lock unsupported)' };
      }
    }

    return { success: false, message: 'Unknown action' };
  } catch (err) {
    console.error('[Sentinel] Dashboard action failed:', err);
    return { success: false, message: `Error: ${err}` };
  }
}

// ──────────────────────────────────────────────
// Batch Action Handler
// ──────────────────────────────────────────────

async function handleBatchAction(
  payload: BatchActionPayload,
  context: Context,
): Promise<{ success: boolean; message: string; count: number }> {
  const subreddit = await context.reddit.getCurrentSubreddit();
  const subredditId = subreddit.id;
  const currentUser = await context.reddit.getCurrentUser();
  const modUsername = currentUser?.username ?? 'moderator';

  let successCount = 0;
  let failCount = 0;

  for (const itemId of payload.itemIds) {
    try {
      const originalItem = await getQueueItem(context.redis, itemId);

      switch (payload.action) {
        case 'approve': {
          await context.reddit.approve(itemId);
          const resolved = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_approved', modUsername, 'Batch approved');
          if (resolved?.authorId) {
            await recordApproval(context.redis, subredditId, resolved.authorId, resolved.authorName);
          }
          await recordManualApproval(context.redis, subredditId);
          if (originalItem && originalItem.suggestedAction !== 'approve') {
            await recordModOverride(context.redis, subredditId, originalItem, 'mod_approved', modUsername);
          }
          if (originalItem) {
            await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
              'batch', itemId, originalItem.type, originalItem.body,
              originalItem.authorName, originalItem.category, originalItem.confidence,
              `moderator:${modUsername}`, `Batch approved`,
            ));
          }
          break;
        }
        case 'remove': {
          await context.reddit.remove(itemId, false);
          const resolved = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_removed', modUsername, 'Batch removed');
          if (resolved?.authorId) {
            await recordViolation(context.redis, subredditId, resolved.authorId, resolved.authorName);
          }
          await recordManualRemoval(context.redis, subredditId);
          if (originalItem && originalItem.suggestedAction !== 'remove') {
            await recordModOverride(context.redis, subredditId, originalItem, 'mod_removed', modUsername);
          }
          if (originalItem) {
            await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
              'batch', itemId, originalItem.type, originalItem.body,
              originalItem.authorName, originalItem.category, originalItem.confidence,
              `moderator:${modUsername}`, `Batch removed`,
            ));
          }
          break;
        }
        case 'ignore': {
          await resolveQueueItem(context.redis, subredditId, itemId, 'ignored', modUsername, 'Batch dismissed');
          if (originalItem) {
            await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
              'batch', itemId, originalItem.type, originalItem.body,
              originalItem.authorName, originalItem.category, originalItem.confidence,
              `moderator:${modUsername}`, `Batch dismissed`,
            ));
          }
          break;
        }
        case 'ban': {
          const item = await resolveQueueItem(context.redis, subredditId, itemId, 'mod_banned', modUsername, 'Batch ban');
          if (item?.authorName) {
            await context.reddit.banUser({
              subredditName: subreddit.name,
              username: item.authorName,
              duration: 30,
              reason: 'Batch moderation action',
              message: 'You have been banned for violating community rules.',
            });
            await context.reddit.remove(itemId, false);
            await recordViolation(context.redis, subredditId, item.authorId, item.authorName);
          }
          await recordManualRemoval(context.redis, subredditId);
          if (originalItem) {
            await recordModOverride(context.redis, subredditId, originalItem, 'mod_banned', modUsername);
            await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
              'batch', itemId, originalItem.type, originalItem.body,
              originalItem.authorName, originalItem.category, originalItem.confidence,
              `moderator:${modUsername}`, `Batch banned (30d)`,
            ));
          }
          break;
        }
      }
      successCount++;
    } catch (err) {
      console.error(`[Sentinel] Batch action failed for ${itemId}:`, err);
      failCount++;
    }
  }

  const label = payload.action === 'approve' ? 'Approved' :
    payload.action === 'remove' ? 'Removed' :
    payload.action === 'ban' ? 'Banned' : 'Dismissed';

  return {
    success: failCount === 0,
    message: `${label} ${successCount} item${successCount !== 1 ? 's' : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}`,
    count: successCount,
  };
}


// ──────────────────────────────────────────────
// Custom Post Definition
// ──────────────────────────────────────────────

export const SentinelDashboardPost = Devvit.addCustomPostType({
  name: 'Sentinel AI Dashboard',
  description: 'Smart moderation dashboard for Sentinel AI',
  height: 'tall',

  render: (context) => {
    const { useState } = context;
    const [launched, setLaunched] = useState(false);

    const onMessage = async (message: WebviewMessage) => {
      const refreshAndSend = async (extra: Record<string, unknown> = {}) => {
        const data = await loadDashboardData(context);
        const derived = computeDerivedStats(data.metrics);
        context.ui.webView.postMessage('sentinel-dashboard',
          JSON.parse(JSON.stringify({
            type: 'INIT_DATA',
            payload: { ...data, derived, ...extra },
          })),
        );
      };

      if (message.type === 'INIT_DATA' || message.type === 'REFRESH') {
        await refreshAndSend();
      }

      if (message.type === 'ACTION_REQUEST') {
        const payload = message.payload as ActionRequestPayload;
        const result = await handleAction(payload, context);
        await refreshAndSend({ actionResult: result });
      }

      if (message.type === 'BATCH_ACTION') {
        const payload = message.payload as BatchActionPayload;
        const result = await handleBatchAction(payload, context);
        await refreshAndSend({ actionResult: result });
      }

      if (message.type === 'RULES_SAVE') {
        const payload = message.payload as RulesSavePayload;
        try {
          const subreddit = await context.reddit.getCurrentSubreddit();
          await saveCustomRules(context.redis, subreddit.id, payload.rules);
          await refreshAndSend({ actionResult: { success: true, message: 'Rules saved successfully' } });
        } catch {
          context.ui.webView.postMessage('sentinel-dashboard',
            JSON.parse(JSON.stringify({
              type: 'INIT_DATA',
              payload: { actionResult: { success: false, message: 'Failed to save rules' } },
            })),
          );
        }
      }

      if (message.type === 'AUDIT_RESTORE') {
        const payload = message.payload as { contentId: string };
        try {
          const subreddit = await context.reddit.getCurrentSubreddit();
          const currentUser = await context.reddit.getCurrentUser();
          const modUsername = currentUser?.username ?? 'moderator';
          await context.reddit.approve(payload.contentId);

          await recordAuditEntry(context.redis, subreddit.id, buildAuditEntry(
            'restore', payload.contentId, 'post', '',
            '', 'restored', 0,
            `moderator:${modUsername}`, 'Content restored from audit log',
          ));

          await refreshAndSend({ actionResult: { success: true, message: 'Content restored successfully' } });
        } catch {
          context.ui.webView.postMessage('sentinel-dashboard',
            JSON.parse(JSON.stringify({
              type: 'INIT_DATA',
              payload: { actionResult: { success: false, message: 'Failed to restore content' } },
            })),
          );
        }
      }
    };

    // ── Landing state (before webview mounts) ────────────
    if (!launched) {
      return (
        <vstack
          alignment="center middle"
          height="100%"
          backgroundColor="#080b14"
          gap="medium"
          padding="large"
        >
          <spacer size="large" />
          <text size="xxlarge" weight="bold" color="#818cf8">Sentinel AI</text>
          <text size="large" weight="bold" color="#f1f5f9">Adaptive Moderation & Queue Intelligence</text>
          <spacer size="small" />
          <text size="medium" color="#64748b" alignment="center">
            AI-powered content analysis · Priority queue · Trust scoring
          </text>
          <spacer size="medium" />
          <button
            appearance="primary"
            size="large"
            onPress={() => {
              setLaunched(true);
            }}
          >
            Open Dashboard
          </button>
          <spacer size="small" />
          <hstack gap="small" alignment="center">
            <text size="xsmall" color="#475569">Moderators only</text>
            <text size="xsmall" color="#475569">·</text>
            <text size="xsmall" color="#475569">Powered by AI + Heuristics</text>
          </hstack>
          <spacer size="large" />
        </vstack>
      );
    }

    // ── Webview launched ──────────────────────────────────
    return (
      <vstack height="100%" width="100%">
        <webview
          id="sentinel-dashboard"
          url="index.html"
          width="100%"
          height="100%"
          onMessage={(msg) => onMessage(msg as unknown as WebviewMessage)}
        />
      </vstack>
    );
  },
});
