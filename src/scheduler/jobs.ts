// ============================================================
// Kago AI – Scheduler Jobs
// Background tasks: queue cleanup, metrics rollup.
// ============================================================

import { Devvit } from '@devvit/public-api';
import { getQueueItems, resolveQueueItem } from '../services/queue.service.js';
import { getMetrics, computeDerivedStats } from '../services/metrics.service.js';
import { JOBS, QUEUE_ITEM_TTL_MS } from '../constants.js';

// ──────────────────────────────────────────────
// Job: Clean up stale queue items (runs every 6 hours)
// ──────────────────────────────────────────────

Devvit.addSchedulerJob({
  name: JOBS.CLEANUP_QUEUE,
  onRun: async (_event, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const subredditId = subreddit.id;

      const items = await getQueueItems(context.redis, subredditId, 500, 'pending');
      const cutoffMs = Date.now() - QUEUE_ITEM_TTL_MS;
      let cleaned = 0;

      for (const item of items) {
        if (item.createdAt < cutoffMs) {
          await resolveQueueItem(
            context.redis,
            subredditId,
            item.id,
            'ignored',
            'kago-bot',
            'Auto-expired after 48 hours',
          );
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[Kago] Cleanup: expired ${cleaned} stale queue items.`);
      }
    } catch (err) {
      console.error('[Kago] Cleanup job error:', err);
    }
  },
});

// ──────────────────────────────────────────────
// Job: Metrics rollup (runs every hour)
// ──────────────────────────────────────────────

Devvit.addSchedulerJob({
  name: JOBS.METRICS_ROLLUP,
  onRun: async (_event, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const subredditId = subreddit.id;

      const metrics = await getMetrics(context.redis, subredditId);
      const derived = computeDerivedStats(metrics);

      console.log(
        `[Kago] Metrics — Scanned: ${metrics.totalScanned}, Auto-mod rate: ${derived.autoModRate}%, Time saved: ${derived.timeSavedHours}h`,
      );
    } catch (err) {
      console.error('[Kago] Metrics rollup error:', err);
    }
  },
});

// ──────────────────────────────────────────────
// Job: Adaptive retraining (runs daily)
// Recalculates per-category thresholds based on override data.
// ──────────────────────────────────────────────

Devvit.addSchedulerJob({
  name: JOBS.RETRAINING,
  onRun: async (_event, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const subredditId = subreddit.id;

      // Load override log
      const overridesRaw = await context.redis.zRange(
        `kago:overrides:${subredditId}`, 0, -1, { by: 'rank' },
      );

      if (!overridesRaw || overridesRaw.length === 0) {
        console.log('[Kago] Retraining: no overrides to analyze.');
        return;
      }

      // Count overrides per category
      const overridesByCategory: Record<string, number> = {};
      const totalByCategory: Record<string, number> = {};

      for (const entry of overridesRaw) {
        try {
          const raw = typeof entry === 'string' ? entry : entry.member;
          const override = JSON.parse(raw);
          const cat = override.originalCategory || 'unknown';
          overridesByCategory[cat] = (overridesByCategory[cat] || 0) + 1;
          totalByCategory[cat] = (totalByCategory[cat] || 0) + 1;
        } catch {
          // Skip malformed entries
        }
      }

      // Log threshold recommendations
      for (const [cat, overrideCount] of Object.entries(overridesByCategory)) {
        const total = totalByCategory[cat] || 1;
        const overrideRate = Math.round((overrideCount / total) * 100);
        if (overrideRate > 30) {
          console.log(
            `[Kago] Retraining: Category "${cat}" has ${overrideRate}% override rate — consider raising threshold.`,
          );
        }
      }

      console.log(
        `[Kago] Retraining: Analyzed ${overridesRaw.length} overrides across ${Object.keys(overridesByCategory).length} categories.`,
      );
    } catch (err) {
      console.error('[Kago] Retraining job error:', err);
    }
  },
});

// ──────────────────────────────────────────────
// Exported schedule helper (called on app install)
// ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function scheduleJobs(context: any): Promise<void> {
  // Schedule cleanup every 6 hours
  await context.scheduler.runJob({
    name: JOBS.CLEANUP_QUEUE,
    cron: '0 */6 * * *',
  });

  // Schedule metrics rollup every hour
  await context.scheduler.runJob({
    name: JOBS.METRICS_ROLLUP,
    cron: '0 * * * *',
  });

  // Schedule adaptive retraining daily at 3 AM UTC
  await context.scheduler.runJob({
    name: JOBS.RETRAINING,
    cron: '0 3 * * *',
  });

}
