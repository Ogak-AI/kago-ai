// ============================================================
// Kago AI – Comment Submit Trigger
// Same pipeline as post trigger, adapted for comments.
// ============================================================

import type { CommentSubmit } from '@devvit/protos';
import type { Context } from '@devvit/public-api';
import { analyzeContent } from '../services/ai.service.js';
import {
  enqueueItem,
  isAlreadyProcessed,
  markProcessed,
} from '../services/queue.service.js';
import {
  getReputation,
  recordViolation,
  recordApproval,
} from '../services/reputation.service.js';
import {
  recordAutoApproval,
  recordAutoRemoval,
  recordScan,
} from '../services/metrics.service.js';
import { loadSettings } from '../services/settings.service.js';
import {
  decide,
  recordTemporalViolation,
  countRecentViolations,
} from '../services/decision.service.js';
import {
  loadCustomRules,
  evaluateRules,
} from '../services/rules.service.js';
import { recordAuditEntry, buildAuditEntry } from '../services/audit.service.js';
import { getAdaptiveThreshold } from '../services/adaptive.service.js';
import {
  publishEvent,
  makeAutoActionEvent,
  makeQueueAddedEvent,
} from '../services/realtime.service.js';
import { AUTO_BAN_DURATION_DAYS } from '../constants.js';

export async function handleCommentSubmit(
  event: CommentSubmit,
  context: Context,
): Promise<void> {
  const { comment, author, subreddit } = event;

  if (!comment || !author || !subreddit) return;

  const itemId = comment.id;

  // ── Dedup ─────────────────────────────────────────────────
  if (await isAlreadyProcessed(context.redis, itemId)) return;
  await markProcessed(context.redis, itemId);

  // ── Settings + Rules ───────────────────────────────────────
  const [settings, customRules] = await Promise.all([
    loadSettings(context),
    loadCustomRules(context.redis, subreddit.id),
  ]);

  const subredditId = subreddit.id;
  const subredditName = subreddit.name;
  const authorId = author.id;
  const authorName = author.name;
  const body = comment.body ?? '';

  // ── User info + reputation ────────────────────────────────
  let accountAgeDays = 0;
  let karma = 0;
  try {
    const userInfo = await context.reddit.getUserById(authorId);
    if (userInfo) {
      const createdAt = userInfo.createdAt
        ? new Date(userInfo.createdAt).getTime()
        : Date.now();
      accountAgeDays = Math.floor((Date.now() - createdAt) / 86400000);
      karma = (userInfo.linkKarma ?? 0) + (userInfo.commentKarma ?? 0);
    }
  } catch {
    console.warn(`[Kago] Could not fetch user info for ${authorName}`);
  }

  const [rep, recentViolations24h] = await Promise.all([
    getReputation(context.redis, subredditId, authorId, authorName, accountAgeDays, karma),
    countRecentViolations(context.redis, subredditId, authorId),
  ]);

  // ── Custom Rule Engine ────────────────────────────────────
  const ruleResult = evaluateRules(customRules, undefined, body);
  let analysis = ruleResult.matched ? ruleResult.analysis : null;
  const triggeredRuleName = ruleResult.matched ? ruleResult.rule.name : undefined;

  // ── AI Analysis ─────────────────────────────────────────
  if (!analysis) {
    analysis = await analyzeContent('comment', undefined, body, authorName, settings, context.reddit, context.redis, subredditId);
  }

  // ── Decision Engine ───────────────────────────────────
  const adaptiveThreshold = await getAdaptiveThreshold(
    context.redis, subredditId, analysis.category, settings.autoRemoveThreshold,
  );

  const decision = decide({
    analysis,
    user: rep,
    settings,
    recentViolations24h,
    reportCount: 0,
    adaptiveThreshold,
  });

  await recordScan(context.redis, subredditId, analysis.category);

  // ── Execute ───────────────────────────────────────────────
  if (decision.action === 'skip') return;

  if (decision.action === 'auto_approve') {
    await recordApproval(context.redis, subredditId, authorId, authorName, accountAgeDays, karma);
    await recordAutoApproval(context.redis, subredditId);
    await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
      'auto_approve', itemId, 'comment', body.slice(0, 120),
      authorName, analysis.category, analysis.confidence,
      triggeredRuleName ? 'rule_engine' : 'ai_auto',
      decision.reason,
    ));
    await publishEvent(context, subredditId, makeAutoActionEvent(
      itemId, 'comment', 'auto_approve', analysis.category, analysis.confidence,
      authorName, decision.reason,
    ));
    return;
  }

  if (decision.action === 'auto_remove') {
    try {
      await context.reddit.remove(itemId, false);
      await recordTemporalViolation(context.redis, subredditId, authorId, itemId);
      await recordViolation(context.redis, subredditId, authorId, authorName, accountAgeDays, karma);
      await recordAutoRemoval(context.redis, subredditId);
      console.log(`[Kago/comment] AUTO-REMOVED ${itemId}`);

      await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
        'auto_remove', itemId, 'comment', body.slice(0, 120),
        authorName, analysis.category, analysis.confidence,
        triggeredRuleName ? 'rule_engine' : 'ai_auto',
        decision.reason,
      ));
      await publishEvent(context, subredditId, makeAutoActionEvent(
        itemId, 'comment', 'auto_remove', analysis.category, analysis.confidence,
        authorName, decision.reason,
      ));
    } catch (err) {
      console.error(`[Kago/comment] Remove failed for ${itemId}:`, err);
    }
    return;
  }

  if (decision.action === 'auto_ban_temp') {
    try {
      await context.reddit.remove(itemId, false);
      await context.reddit.banUser({
        subredditName,
        username: authorName,
        duration: AUTO_BAN_DURATION_DAYS,
        reason: decision.reason,
        message: `You have been temporarily banned (${AUTO_BAN_DURATION_DAYS} days): ${decision.reason}`,
      });
      await recordTemporalViolation(context.redis, subredditId, authorId, itemId);
      await recordViolation(context.redis, subredditId, authorId, authorName, accountAgeDays, karma);
      await recordAutoRemoval(context.redis, subredditId);

      await recordAuditEntry(context.redis, subredditId, buildAuditEntry(
        'auto_remove', itemId, 'comment', body.slice(0, 120),
        authorName, analysis.category, analysis.confidence,
        triggeredRuleName ? 'rule_engine' : 'ai_auto',
        `Auto-banned (${AUTO_BAN_DURATION_DAYS}d): ${decision.reason}`,
      ));
      await publishEvent(context, subredditId, makeAutoActionEvent(
        itemId, 'comment', 'auto_ban_temp', analysis.category, analysis.confidence,
        authorName, decision.reason,
      ));
    } catch (err) {
      console.error(`[Kago/comment] Auto-ban failed:`, err);
    }
    return;
  }

  // Enqueue
  if (['enqueue_high', 'enqueue_medium', 'enqueue_low'].includes(decision.action)) {
    const postPermalink = comment.postId
      ? `https://reddit.com/r/${subredditName}/comments/${comment.postId.replace('t3_', '')}/`
      : `https://reddit.com/r/${subredditName}/`;

    const queued = await enqueueItem(context.redis, subredditId, analysis, {
      id: itemId,
      type: 'comment',
      body: body.slice(0, 600),
      authorName,
      authorId,
      permalink: postPermalink,
      subredditName,
      createdAt: comment.createdAt ? new Date(comment.createdAt).getTime() : Date.now(),
      reportCount: 0,
      trustScore: rep.trustScore,
      decisionReason: decision.reason,
      triggeredRule: triggeredRuleName,
    });

    await publishEvent(context, subredditId, makeQueueAddedEvent(queued));
  }
}
