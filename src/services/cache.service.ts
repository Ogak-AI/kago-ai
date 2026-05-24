// ============================================================
// Sentinel AI – Cache Service
// Redis-backed caching for AI analysis results.
// Prevents duplicate OpenAI calls for identical content.
// ============================================================

import type { RedisClient } from '@devvit/public-api';
import type { AIAnalysisResult } from '../types.js';
import { Keys, AI_CACHE_TTL_SECONDS } from '../constants.js';

/**
 * Generate a deterministic hash for content deduplication.
 * Uses a fast djb2-variant hash — sufficient for cache keys.
 */
export function hashContent(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0x7fffffff;
  }
  return hash.toString(36);
}

/**
 * Look up a cached AI analysis result for the given content.
 * Returns null on cache miss or corrupted data.
 */
export async function getCachedAnalysis(
  redis: RedisClient,
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
): Promise<AIAnalysisResult | null> {
  const raw = [contentType, title ?? '', body].join('||');
  const key = Keys.analysisCache(hashContent(raw));

  try {
    const cached = await redis.get(key);
    if (!cached) return null;
    const parsed = JSON.parse(cached) as AIAnalysisResult;
    // Validate required fields exist
    if (parsed.category && typeof parsed.confidence === 'number') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store an AI analysis result in cache with TTL.
 */
export async function setCachedAnalysis(
  redis: RedisClient,
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
  result: AIAnalysisResult,
): Promise<void> {
  const raw = [contentType, title ?? '', body].join('||');
  const key = Keys.analysisCache(hashContent(raw));

  try {
    await redis.set(key, JSON.stringify(result), {
      expiration: new Date(Date.now() + AI_CACHE_TTL_SECONDS * 1000),
    });
  } catch {
    // Cache write failures are non-critical — log and continue
    console.warn('[Sentinel/cache] Failed to write analysis cache');
  }
}

/**
 * Invalidate a cached analysis (e.g. when content is edited).
 */
export async function invalidateCache(
  redis: RedisClient,
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
): Promise<void> {
  const raw = [contentType, title ?? '', body].join('||');
  const key = Keys.analysisCache(hashContent(raw));
  try {
    await redis.del(key);
  } catch {
    // Non-critical
  }
}
