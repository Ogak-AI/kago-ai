// ============================================================
// Kago AI – Moderation Orchestration Service
// High-level pipeline that ties together AI analysis, caching,
// decision engine, queue routing, metrics, and audit logging.
// Used by triggers to avoid duplicating orchestration logic.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { AIAnalysisResult, ContentType, KagoSettings, UserReputation } from '../types.js';
import { analyzeContent } from './ai.service.js';
import { getCachedAnalysis, setCachedAnalysis } from './cache.service.js';
import { decide } from './decision.service.js';
import { getAdaptiveThreshold } from './adaptive.service.js';
import { countRecentViolations, recordTemporalViolation } from './decision.service.js';
import { loadCustomRules, evaluateRules } from './rules.service.js';
import { getReputation, recordViolation, recordApproval } from './reputation.service.js';
import { recordScan, recordAutoRemoval, recordAutoApproval } from './metrics.service.js';
import { recordAuditEntry, buildAuditEntry } from './audit.service.js';
import { enqueueItem } from './queue.service.js';
import type { DecisionResult } from '../types.js';

/**
 * Full moderation pipeline result — everything needed to execute the decision.
 */
export interface ModerationPipelineResult {
  analysis: AIAnalysisResult;
  decision: DecisionResult;
  triggeredRuleName?: string;
  cached: boolean;
  processingTimeMs: number;
}

/**
 * Unified content input for the pipeline.
 */
export interface ModerationInput {
  itemId: string;
  contentType: ContentType;
  title?: string;
  body: string;
  authorId: string;
  authorName: string;
  subredditId: string;
  subredditName: string;
  permalink: string;
  createdAt: number;
  reportCount: number;
  accountAgeDays: number;
  karma: number;
}

/**
 * Run the full moderation pipeline for a piece of content.
 * Steps:
 *   1. Load settings + custom rules
 *   2. Get user reputation + temporal violation count
 *   3. Check analysis cache
 *   4. Evaluate custom rules (short-circuit)
 *   5. Run AI analysis (if no rule matched and no cache hit)
 *   6. Cache the result
 *   7. Run the decision engine
 *   8. Record scan metrics
 *   9. Return everything needed to execute the decision
 */
export async function runModerationPipeline(
  input: ModerationInput,
  settings: KagoSettings,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redditApi: any,
  redis: RedisClient,
): Promise<ModerationPipelineResult> {
  const startTime = performance.now();
  let cached = false;
  let triggeredRuleName: string | undefined;

  // ── 1. Load custom rules ──────────────────────────────────
  const customRules = await loadCustomRules(redis, input.subredditId);

  // ── 2. User reputation + recent violations ────────────────
  const [rep, recentViolations24h] = await Promise.all([
    getReputation(
      redis, input.subredditId, input.authorId, input.authorName,
      input.accountAgeDays, input.karma,
    ),
    countRecentViolations(redis, input.subredditId, input.authorId),
  ]);

  // ── 3. Custom Rule Engine (evaluated before AI) ───────────
  const ruleResult = evaluateRules(
    customRules,
    input.contentType === 'post' ? input.title : undefined,
    input.body,
  );

  let analysis: AIAnalysisResult | null = ruleResult.matched ? ruleResult.analysis : null;
  if (ruleResult.matched) {
    triggeredRuleName = ruleResult.rule.name;
  }

  // ── 4. Check cache (if no rule matched) ───────────────────
  if (!analysis) {
    const cachedResult = await getCachedAnalysis(
      redis, input.contentType, input.title, input.body,
    );
    if (cachedResult) {
      analysis = cachedResult;
      cached = true;
    }
  }

  // ── 5. AI Analysis (if no rule matched and no cache hit) ──
  if (!analysis) {
    analysis = await analyzeContent(
      input.contentType,
      input.title,
      input.body,
      input.authorName,
      settings,
      redditApi,
      redis,
      input.subredditId,
    );

    // ── 6. Cache the result ─────────────────────────────────
    await setCachedAnalysis(redis, input.contentType, input.title, input.body, analysis);
  }

  // ── 7. Decision Engine ────────────────────────────────────
  const adaptiveThreshold = await getAdaptiveThreshold(
    redis, input.subredditId, analysis.category, settings.autoRemoveThreshold,
  );

  const decision = decide({
    analysis,
    user: rep,
    settings,
    recentViolations24h,
    reportCount: input.reportCount,
    adaptiveThreshold,
  });

  // ── 8. Record scan ────────────────────────────────────────
  await recordScan(redis, input.subredditId, analysis.category);

  const processingTimeMs = Math.round(performance.now() - startTime);

  return {
    analysis,
    decision,
    triggeredRuleName,
    cached,
    processingTimeMs,
  };
}
