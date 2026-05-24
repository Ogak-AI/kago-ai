import type { RedisClient } from '@devvit/public-api';
import type { AuditEntry, KagoMetrics } from '../types.js';

export interface ModerationSummary {
  generatedAt: number;
  period: string;
  highlights: string[];
  metrics: {
    totalActions: number;
    autoActions: number;
    manualActions: number;
    topCategory: string;
    topCategoryCount: number;
    uniqueModerators: number;
    actionableInsights: number;
  };
  notableEvents: string[];
}

export async function generateModerationSummary(
  redis: RedisClient,
  subredditId: string,
  metrics: KagoMetrics,
  auditLog: AuditEntry[],
): Promise<ModerationSummary> {
  const totalActions = auditLog.length;
  const autoActions = auditLog.filter(
    e => e.actionType === 'auto_remove' || e.actionType === 'auto_approve' || e.actionType === 'auto_ban'
  ).length;
  const manualActions = totalActions - autoActions;

  const mods = new Set<string>();
  for (const entry of auditLog) {
    if (entry.triggeredBy && entry.triggeredBy.startsWith('moderator:')) {
      mods.add(entry.triggeredBy.replace('moderator:', ''));
    }
  }

  const categoryCounts: Record<string, number> = {
    spam: metrics.spamCount || 0,
    toxicity: metrics.toxicityCount || 0,
    hate_speech: metrics.hateSpeechCount || 0,
    scam: metrics.scamCount || 0,
    rule_violation: metrics.ruleViolationCount || 0,
    low_effort: metrics.lowEffortCount || 0,
    self_promotion: metrics.selfPromotionCount || 0,
    manipulation: metrics.manipulationCount || 0,
    nsfw: metrics.nsfwCount || 0,
    brigading: metrics.brigadingCount || 0,
  };

  let topCategory = 'none';
  let topCategoryCount = 0;
  for (const [cat, count] of Object.entries(categoryCounts)) {
    if (count > topCategoryCount) {
      topCategory = cat;
      topCategoryCount = count;
    }
  }

  const highlights: string[] = [];
  if (metrics.autoRemoved > 0) {
    highlights.push(`Auto-removed ${metrics.autoRemoved} items without moderator intervention`);
  }
  if (metrics.falsePositives > 0) {
    highlights.push(`Recorded ${metrics.falsePositives} false positives — AI is learning from corrections`);
  }
  if (mods.size > 0) {
    highlights.push(`${mods.size} moderator${mods.size !== 1 ? 's' : ''} active on the queue`);
  }
  if (topCategoryCount > 0 && topCategory !== 'none') {
    highlights.push(`Most common violation: ${topCategory} (${topCategoryCount} detections)`);
  }

  const notableEvents: string[] = [];
  if (metrics.scamCount > 5) notableEvents.push(`Scam campaign detected: ${metrics.scamCount} scam posts intercepted`);
  if (metrics.hateSpeechCount > 3) notableEvents.push(`Hate speech spike: ${metrics.hateSpeechCount} instances flagged`);
  if (metrics.toxicityCount > 20) notableEvents.push(`Toxicity surge: ${metrics.toxicityCount} toxic comments this period`);

  const summary: ModerationSummary = {
    generatedAt: Date.now(),
    period: 'Last 24 hours',
    highlights,
    metrics: {
      totalActions,
      autoActions,
      manualActions,
      topCategory,
      topCategoryCount,
      uniqueModerators: mods.size,
      actionableInsights: notableEvents.length,
    },
    notableEvents,
  };

  return summary;
}
