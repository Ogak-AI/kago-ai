import type { RedisClient } from '@devvit/public-api';
import type { SentinelMetrics, FlaggedItem, UserReputation } from '../types.js';

export interface SubredditHealthScore {
  overall: number;
  categories: {
    contentSafety: number;
    modEfficiency: number;
    userHealth: number;
    responseTime: number;
  };
  trends: {
    toxicityTrend: 'improving' | 'stable' | 'worsening';
    spamTrend: 'improving' | 'stable' | 'worsening';
    modBurdenTrend: 'improving' | 'stable' | 'worsening';
  };
  riskIndicators: string[];
  recommendations: string[];
}

const HEALTH_KEY = (subredditId: string) => `sentinel:health:${subredditId}`;

export async function computeHealthScore(
  redis: RedisClient,
  subredditId: string,
  metrics: SentinelMetrics,
  queueItems: FlaggedItem[],
  topUsers: UserReputation[],
): Promise<SubredditHealthScore> {
  const total = metrics.totalScanned || 1;
  const toxicityRatio = (metrics.toxicityCount || 0) / total;
  const spamRatio = (metrics.spamCount || 0) / total;
  const scamRatio = (metrics.scamCount || 0) / total;
  const hateRatio = (metrics.hateSpeechCount || 0) / total;
  const autoModRate = metrics.autoRemoved / Math.max(metrics.autoRemoved + metrics.manuallyRemoved, 1);
  const fpRate = metrics.falsePositives / Math.max(total, 1);
  const queueDepth = queueItems.filter(i => i.status === 'pending').length;
  const highRiskUsers = topUsers.filter(u => (u.trustScore || 0) < 25).length;

  const contentSafety = Math.round(
    (1 - (toxicityRatio * 3 + spamRatio * 2 + scamRatio * 4 + hateRatio * 5)) * 100
  );
  const modEfficiency = Math.round(autoModRate * 100);
  const userHealth = Math.round(Math.max(0, 100 - highRiskUsers * 8));
  const responseTime = Math.round(Math.max(0, 100 - queueDepth * 2));

  const overall = Math.round(
    contentSafety * 0.35 + modEfficiency * 0.30 + userHealth * 0.20 + responseTime * 0.15
  );

  const trends = {
    toxicityTrend: toxicityRatio > 0.1 ? 'worsening' as const : toxicityRatio > 0.05 ? 'stable' as const : 'improving' as const,
    spamTrend: spamRatio > 0.15 ? 'worsening' as const : spamRatio > 0.08 ? 'stable' as const : 'improving' as const,
    modBurdenTrend: queueDepth > 30 ? 'worsening' as const : queueDepth > 10 ? 'stable' as const : 'improving' as const,
  };

  const riskIndicators: string[] = [];
  if (toxicityRatio > 0.1) riskIndicators.push('High toxicity ratio — consider tightening rules');
  if (scamRatio > 0.05) riskIndicators.push('Scam activity detected — review scam patterns');
  if (hateRatio > 0.02) riskIndicators.push('Hate speech detected — escalate to Reddit admin');
  if (fpRate > 0.05) riskIndicators.push('Elevated false positive rate — consider adjusting thresholds');
  if (highRiskUsers > 5) riskIndicators.push(`${highRiskUsers} high-risk users active — monitor closely`);
  if (queueDepth > 50) riskIndicators.push('Queue backlog growing — add more moderators');

  const recommendations: string[] = [];
  if (autoModRate < 0.5) recommendations.push('Lower auto-remove threshold for spam to reduce manual workload');
  if (toxicityRatio > 0.08) recommendations.push('Enable stricter toxicity detection for known problem users');
  if (fpRate > 0.03) recommendations.push('Review recent false positives to improve AI accuracy');
  if (queueDepth > 20) recommendations.push('Batch approve/remove similar items to clear queue faster');
  if (overall < 50) recommendations.push('Critical: Subreddit health score is low — immediate action recommended');

  const score: SubredditHealthScore = {
    overall,
    categories: {
      contentSafety: Math.max(0, Math.min(100, contentSafety)),
      modEfficiency: Math.max(0, Math.min(100, modEfficiency)),
      userHealth: Math.max(0, Math.min(100, userHealth)),
      responseTime: Math.max(0, Math.min(100, responseTime)),
    },
    trends,
    riskIndicators,
    recommendations,
  };

  await redis.set(HEALTH_KEY(subredditId), JSON.stringify(score));
  return score;
}

export async function getHealthScore(
  redis: RedisClient,
  subredditId: string,
): Promise<SubredditHealthScore | null> {
  const raw = await redis.get(HEALTH_KEY(subredditId));
  return raw ? JSON.parse(raw) : null;
}
