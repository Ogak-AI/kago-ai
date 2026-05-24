// ============================================================
// Kago AI – Post Menu Actions
// Moderator-only quick actions on posts.
// Records mod overrides for adaptive learning.
// ============================================================

import type { Context, MenuItem } from '@devvit/public-api';
import {
  getQueueItem,
  resolveQueueItem,
} from '../services/queue.service.js';
import {
  recordApproval,
  recordViolation,
} from '../services/reputation.service.js';
import {
  recordFalsePositive,
  recordManualApproval,
  recordManualRemoval,
} from '../services/metrics.service.js';
import { loadSettings, formatRemovalComment } from '../services/settings.service.js';
import { Keys, MAX_OVERRIDE_LOG } from '../constants.js';
import type { ModOverride } from '../types.js';

// ──────────────────────────────────────────────
// Shared helper: resolve and update reputation
// ──────────────────────────────────────────────

async function resolveAndUpdate(
  postId: string,
  action: 'mod_approved' | 'mod_removed' | 'mod_banned' | 'ignored',
  context: Context,
): Promise<void> {
  const settings = await loadSettings(context);
  const subreddit = await context.reddit.getCurrentSubreddit();
  const subredditId = subreddit.id;
  const subredditName = subreddit.name;

  const currentUser = await context.reddit.getCurrentUser();
  const modUsername = currentUser?.username ?? 'moderator';

  // Get queued item if present (may not be in queue if content was clean)
  const queuedItem = await getQueueItem(context.redis, postId);

  try {
    switch (action) {
      case 'mod_approved': {
        await context.reddit.approve(postId);

        if (queuedItem) {
          // This is a false positive — Kago wanted to remove, mod approved
          if (queuedItem.suggestedAction === 'remove' || queuedItem.suggestedAction === 'ban') {
            await recordFalsePositive(context.redis, subredditId);
          }
          await resolveQueueItem(
            context.redis,
            subredditId,
            postId,
            'mod_approved',
            modUsername,
            'Manually approved by moderator',
          );
        }

        // Update user reputation positively
        if (queuedItem?.authorId) {
          await recordApproval(context.redis, subredditId, queuedItem.authorId, queuedItem.authorName);
          // Record override for adaptive learning
          if (queuedItem.suggestedAction === 'remove' || queuedItem.suggestedAction === 'ban') {
            const override: ModOverride = {
              itemId: postId,
              originalCategory: queuedItem.category,
              originalConfidence: queuedItem.confidence,
              modAction: 'mod_approved',
              modUsername,
              timestamp: Date.now(),
            };
            const score = override.timestamp;
            await context.redis.zAdd(Keys.overrides(subredditId), { member: JSON.stringify(override), score });
            
            const count = await context.redis.zCard(Keys.overrides(subredditId));
            if (count > MAX_OVERRIDE_LOG) {
              await context.redis.zRemRangeByRank(Keys.overrides(subredditId), 0, count - MAX_OVERRIDE_LOG - 1);
            }
          }
        }
        await recordManualApproval(context.redis, subredditId);

        context.ui.showToast({ text: 'Post approved. User trust score improved.', appearance: 'success' });
        break;
      }

      case 'mod_removed': {
        await context.reddit.remove(postId, false);

        if (queuedItem) {
          await resolveQueueItem(
            context.redis,
            subredditId,
            postId,
            'mod_removed',
            modUsername,
            'Manually removed by moderator',
          );

          if (queuedItem.authorId) {
            await recordViolation(context.redis, subredditId, queuedItem.authorId, queuedItem.authorName);
          }

          // Post removal reason comment if enabled
          if (settings.enableRemovalComments && queuedItem.explanation) {
            try {
              const reason = `${queuedItem.category.replace('_', ' ')} — ${queuedItem.explanation}`;
              const commentText = formatRemovalComment(settings.removalComment, reason);
              const comment = await context.reddit.submitComment({ id: postId, text: commentText });
              await comment.distinguish(true);
            } catch {
              // Non-critical
            }
          }
        }

        await recordManualRemoval(context.redis, subredditId);
        context.ui.showToast({ text: 'Post removed. User trust score decreased.', appearance: 'success' });
        break;
      }

      case 'mod_banned': {
        if (queuedItem?.authorName) {
          try {
            await context.reddit.banUser({
              subredditName,
              username: queuedItem.authorName,
              duration: 30,
              reason: queuedItem.explanation ?? 'Violation of subreddit rules',
              message: `You have been temporarily banned for: ${queuedItem.explanation ?? 'violation of subreddit rules'}`,
            });
            await resolveQueueItem(
              context.redis,
              subredditId,
              postId,
              'mod_banned',
              modUsername,
              'User banned by moderator',
            );
            await recordViolation(context.redis, subredditId, queuedItem.authorId, queuedItem.authorName);
            await context.reddit.remove(postId, false);
          } catch (e) {
            context.ui.showToast({ text: `Could not ban user: ${e}`, appearance: 'neutral' });
            return;
          }
        }
        await recordManualRemoval(context.redis, subredditId);
        context.ui.showToast({ text: 'User banned (30 days) and post removed.', appearance: 'success' });
        break;
      }

      case 'ignored': {
        if (queuedItem) {
          await resolveQueueItem(
            context.redis,
            subredditId,
            postId,
            'ignored',
            modUsername,
            'Dismissed by moderator',
          );
        }
        context.ui.showToast({ text: 'Post dismissed from Kago queue.', appearance: 'neutral' });
        break;
      }
    }
  } catch (err) {
    console.error(`[Kago] Post menu action failed:`, err);
    context.ui.showToast({ text: 'Action failed. Check app logs.', appearance: 'neutral' });
  }
}

// ──────────────────────────────────────────────
// Menu Item Definitions
// ──────────────────────────────────────────────

export const kagoApprovePost: MenuItem = {
  label: 'Kago: Approve Post',
  description: 'Approve this post, record a Kago false-positive if it was flagged, and boost the author’s trust score.',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const postId = event.targetId;
    if (!postId) return;
    await resolveAndUpdate(postId, 'mod_approved', context);
  },
};

export const kagoRemovePost: MenuItem = {
  label: 'Kago: Remove Post',
  description: 'Remove this post, record a violation against the author, and post the configured removal-reason comment.',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const postId = event.targetId;
    if (!postId) return;
    await resolveAndUpdate(postId, 'mod_removed', context);
  },
};

export const kagoBanUserPost: MenuItem = {
  label: 'Kago: Ban User (30d)',
  description: 'Remove this post and temporarily ban the author for 30 days with a Kago-generated reason.',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const postId = event.targetId;
    if (!postId) return;
    await resolveAndUpdate(postId, 'mod_banned', context);
  },
};

export const kagoIgnorePost: MenuItem = {
  label: 'Kago: Dismiss from Queue',
  description: 'Remove this item from the Kago queue without taking action on the post itself.',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (event, context) => {
    const postId = event.targetId;
    if (!postId) return;
    await resolveAndUpdate(postId, 'ignored', context);
  },
};
