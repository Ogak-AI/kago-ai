// ============================================================
// Kago AI – Subreddit Rule Engine
//
// Allows moderators to define custom rules with keywords,
// per-rule thresholds, and per-rule actions.
// Custom rules are evaluated BEFORE the AI analysis and can
// short-circuit it entirely for known patterns.
//
// Rule format (stored as JSON in Redis):
// {
//   "id": "no-self-promo",
//   "name": "No Self-Promotion",
//   "keywords": ["buy now", "use my code", "promo code"],
//   "threshold": 80,       ← % keyword match confidence (currently always 100 if keyword found)
//   "action": "remove",
//   "reason": "Self-promotion is not allowed in this community.",
//   "enabled": true
// }
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { AIAnalysisResult, SubredditRule } from '../types.js';
import { Keys } from '../constants.js';

// ──────────────────────────────────────────────
// Default Starter Rules
// ──────────────────────────────────────────────

export const DEFAULT_RULES: SubredditRule[] = [
  {
    id: 'no-self-promo',
    name: 'No Self-Promotion',
    keywords: ['buy now', 'use my code', 'promo code', 'discount code', 'affiliate'],
    threshold: 80,
    action: 'remove',
    reason: 'Self-promotion or affiliate marketing is not allowed.',
    enabled: true,
  },
  {
    id: 'no-crypto-spam',
    name: 'No Crypto Spam',
    keywords: ['guaranteed profit', 'guaranteed return', '1000x', 'moon soon', 'free bitcoin', 'airdrop'],
    threshold: 75,
    action: 'remove',
    reason: 'Cryptocurrency spam or unrealistic investment claims are not allowed.',
    enabled: true,
  },
  {
    id: 'no-doxxing',
    name: 'No Personal Information',
    keywords: ['home address', 'phone number', 'social security', 'credit card number'],
    threshold: 90,
    action: 'ban',
    reason: 'Sharing personal information (doxxing) is a serious violation.',
    enabled: true,
  },
];

// ──────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────

export async function loadCustomRules(
  redis: RedisClient,
  subredditId: string,
): Promise<SubredditRule[]> {
  const raw = await redis.get(Keys.customRules(subredditId));
  if (!raw) return DEFAULT_RULES;
  try {
    const parsed = JSON.parse(raw) as SubredditRule[];
    return Array.isArray(parsed) ? parsed : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

export async function saveCustomRules(
  redis: RedisClient,
  subredditId: string,
  rules: SubredditRule[],
): Promise<void> {
  await redis.set(Keys.customRules(subredditId), JSON.stringify(rules));
}

// ──────────────────────────────────────────────
// Rule Evaluation
// ──────────────────────────────────────────────

export interface RuleMatchResult {
  matched: true;
  rule: SubredditRule;
  /** Synthesized AIAnalysisResult based on the rule match */
  analysis: AIAnalysisResult;
}

export interface RuleNoMatchResult {
  matched: false;
}

export type RuleEvaluationResult = RuleMatchResult | RuleNoMatchResult;

/**
 * Evaluate content against all enabled custom rules.
 * Returns the first matching rule (rules are evaluated in order).
 *
 * If a rule matches, returns a synthetic AIAnalysisResult so the
 * Decision Engine can process it uniformly.
 */
export function evaluateRules(
  rules: SubredditRule[],
  title: string | undefined,
  body: string,
): RuleEvaluationResult {
  const fullText = [title ?? '', body].join(' ').toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.keywords || rule.keywords.length === 0) continue;

    const matchedKeyword = rule.keywords.find((kw) =>
      kw.trim().length > 0 && fullText.includes(kw.trim().toLowerCase()),
    );

    if (matchedKeyword) {
      // Confidence is always 100 for an exact keyword match
      const confidence = 100;

      // Map rule action to suggestedAction
      const suggestedAction =
        rule.action === 'ban' ? 'ban' :
        rule.action === 'remove' ? 'remove' : 'review';

      const analysis: AIAnalysisResult = {
        category: 'rule_violation',
        confidence,
        severity: rule.action === 'ban' ? 'high' : rule.action === 'remove' ? 'medium' : 'low',
        explanation: `Rule "${rule.name}" triggered by keyword: "${matchedKeyword}". ${rule.reason}`,
        suggestedAction,
        source: 'heuristic',
      };

      return { matched: true, rule, analysis };
    }
  }

  return { matched: false };
}
