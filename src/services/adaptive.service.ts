// ============================================================
// Kago AI – Adaptive Learning Service
//
// Consumes moderator overrides and adjusts per-category
// confidence thresholds so the system genuinely learns
// from human feedback over time.
//
// How it works:
//   1. Every mod override is already recorded in Redis
//   2. This service reads override history and computes
//      per-category "override rates" (how often mods disagree)
//   3. Categories with high override rates get their
//      auto-action threshold raised (more conservative)
//   4. Categories with low override rates get threshold
//      lowered (more aggressive — the AI is reliable there)
//
// The adjustments are stored as a Redis hash and consulted
// by the Decision Engine on every new content evaluation.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { ModOverride, ViolationCategory } from '../types.js';
import { Keys, DEFAULT_SETTINGS } from '../constants.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CategoryAdjustment {
  category: ViolationCategory;
  /** Number of AI decisions in this category */
  totalDecisions: number;
  /** Number of times mods overrode the AI */
  overrideCount: number;
  /** Override rate as percentage (0–100) */
  overrideRate: number;
  /** Adjusted confidence threshold for auto-action */
  adjustedThreshold: number;
  /** Direction of adjustment: 'raised' | 'lowered' | 'unchanged' */
  direction: 'raised' | 'lowered' | 'unchanged';
}

export interface AdaptiveState {
  /** Per-category threshold adjustments */
  adjustments: Record<string, CategoryAdjustment>;
  /** When the adjustments were last recalculated */
  lastRecalculated: number;
  /** Total overrides analyzed */
  totalOverridesAnalyzed: number;
}

// ──────────────────────────────────────────────
// Redis Key
// ──────────────────────────────────────────────

const adaptiveKey = (subredditId: string) => `kago:adaptive:${subredditId}`;

// ──────────────────────────────────────────────
// Core Algorithm
// ──────────────────────────────────────────────

/**
 * Recalculate adaptive thresholds based on override history.
 *
 * Algorithm:
 *   1. Read all overrides from Redis
 *   2. Group by original AI category
 *   3. For each category:
 *      - If override rate > 30%: raise threshold by (overrideRate - 30) * 0.15
 *      - If override rate < 10%: lower threshold by (10 - overrideRate) * 0.1
 *      - Clamp between 75 and 98
 *   4. Store adjustments in Redis
 */
export async function recalculateAdaptiveThresholds(
  redis: RedisClient,
  subredditId: string,
  baseThreshold: number = DEFAULT_SETTINGS.autoRemoveThreshold,
): Promise<AdaptiveState> {
  // Read all overrides
  const overrideKey = Keys.overrides(subredditId);
  const rawOverrides = await redis.zRange(overrideKey, 0, -1, { by: 'rank' });

  const overrides: ModOverride[] = [];
  if (rawOverrides && rawOverrides.length > 0) {
    for (const entry of rawOverrides) {
      try {
        const raw = typeof entry === 'string' ? entry : (entry as { member: string }).member;
        overrides.push(JSON.parse(raw) as ModOverride);
      } catch {
        // Skip malformed entries
      }
    }
  }

  // Group by original AI category
  const categoryStats: Record<string, { total: number; overrides: number }> = {};

  for (const override of overrides) {
    const cat = override.originalCategory;
    if (!categoryStats[cat]) {
      categoryStats[cat] = { total: 0, overrides: 0 };
    }
    categoryStats[cat].total += 1;

    // An override means the mod took a different action than the AI suggested
    // mod_approved when AI said remove/ban = AI was wrong (false positive)
    // mod_removed when AI said approve = AI was wrong (false negative)
    categoryStats[cat].overrides += 1;
  }

  // Calculate adjustments
  const adjustments: Record<string, CategoryAdjustment> = {};

  for (const [cat, stats] of Object.entries(categoryStats)) {
    const overrideRate = stats.total > 0
      ? Math.round((stats.overrides / stats.total) * 100)
      : 0;

    let adjustedThreshold = baseThreshold;
    let direction: 'raised' | 'lowered' | 'unchanged' = 'unchanged';

    if (stats.total >= 5) {
      // Only adjust if we have enough data (minimum 5 decisions)
      if (overrideRate > 30) {
        // AI is wrong too often — make it more conservative
        const raise = Math.round((overrideRate - 30) * 0.15);
        adjustedThreshold = Math.min(98, baseThreshold + raise);
        direction = 'raised';
      } else if (overrideRate < 10) {
        // AI is very accurate — let it be more aggressive
        const lower = Math.round((10 - overrideRate) * 0.1);
        adjustedThreshold = Math.max(75, baseThreshold - lower);
        direction = 'lowered';
      }
    }

    adjustments[cat] = {
      category: cat as ViolationCategory,
      totalDecisions: stats.total,
      overrideCount: stats.overrides,
      overrideRate,
      adjustedThreshold,
      direction,
    };
  }

  const state: AdaptiveState = {
    adjustments,
    lastRecalculated: Date.now(),
    totalOverridesAnalyzed: overrides.length,
  };

  // Persist
  await redis.set(adaptiveKey(subredditId), JSON.stringify(state));
  return state;
}

/**
 * Get the adaptive threshold for a specific category.
 * Falls back to base threshold if no adaptive data exists.
 */
export async function getAdaptiveThreshold(
  redis: RedisClient,
  subredditId: string,
  category: ViolationCategory,
  baseThreshold: number,
): Promise<number> {
  try {
    const raw = await redis.get(adaptiveKey(subredditId));
    if (!raw) return baseThreshold;

    const state = JSON.parse(raw) as AdaptiveState;
    const adjustment = state.adjustments[category];
    if (adjustment && adjustment.totalDecisions >= 5) {
      return adjustment.adjustedThreshold;
    }
  } catch {
    // Fallback silently
  }
  return baseThreshold;
}

/**
 * Get the full adaptive state for dashboard display.
 */
export async function getAdaptiveState(
  redis: RedisClient,
  subredditId: string,
): Promise<AdaptiveState | null> {
  try {
    const raw = await redis.get(adaptiveKey(subredditId));
    if (!raw) return null;
    return JSON.parse(raw) as AdaptiveState;
  } catch {
    return null;
  }
}
