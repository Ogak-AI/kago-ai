// ============================================================
// Kago AI – Settings Helper
// Loads and normalizes app settings from Devvit settings API.
// ============================================================

import type { Context } from '@devvit/public-api';
import type { KagoSettings } from '../types.js';
import { DEFAULT_SETTINGS } from '../constants.js';

/**
 * Load all Kago settings from Devvit's settings store.
 * Falls back to defaults for any missing values.
 */
export async function loadSettings(context: Context): Promise<KagoSettings> {
  const get = async <T>(key: string, fallback: T): Promise<T> => {
    try {
      const val = await context.settings.get<T>(key);
      return val !== undefined && val !== null ? val : fallback;
    } catch {
      return fallback;
    }
  };

  const [
    openaiApiKey,
    aiModel,
    autoRemoveThreshold,
    autoApproveTrustedUsers,
    trustedUserThreshold,
    lowTrustThreshold,
    bannedKeywordsRaw,
    subredditRules,
    removalComment,
    enableRemovalComments,
  ] = await Promise.all([
    get<string>('openaiApiKey', DEFAULT_SETTINGS.openaiApiKey),
    get<string>('aiModel', DEFAULT_SETTINGS.aiModel),
    get<number>('autoRemoveThreshold', DEFAULT_SETTINGS.autoRemoveThreshold),
    get<boolean>('autoApproveTrustedUsers', DEFAULT_SETTINGS.autoApproveTrustedUsers),
    get<number>('trustedUserThreshold', DEFAULT_SETTINGS.trustedUserThreshold),
    get<number>('lowTrustThreshold', DEFAULT_SETTINGS.lowTrustThreshold),
    get<string>('bannedKeywords', ''),
    get<string>('subredditRules', DEFAULT_SETTINGS.subredditRules),
    get<string>('removalComment', DEFAULT_SETTINGS.removalComment),
    get<boolean>('enableRemovalComments', DEFAULT_SETTINGS.enableRemovalComments),
  ]);

  // Parse comma-separated banned keywords
  const bannedKeywords = bannedKeywordsRaw
    ? bannedKeywordsRaw
        .split(',')
        .map((k: string) => k.trim().toLowerCase())
        .filter((k: string) => k.length > 0)
    : [];

  return {
    openaiApiKey: openaiApiKey ?? '',
    aiModel: aiModel ?? DEFAULT_SETTINGS.aiModel,
    autoRemoveThreshold: Number(autoRemoveThreshold) || DEFAULT_SETTINGS.autoRemoveThreshold,
    autoApproveTrustedUsers:
      autoApproveTrustedUsers ?? DEFAULT_SETTINGS.autoApproveTrustedUsers,
    trustedUserThreshold: Number(trustedUserThreshold) || DEFAULT_SETTINGS.trustedUserThreshold,
    lowTrustThreshold: Number(lowTrustThreshold) || DEFAULT_SETTINGS.lowTrustThreshold,
    bannedKeywords,
    subredditRules: subredditRules ?? DEFAULT_SETTINGS.subredditRules,
    removalComment: removalComment ?? DEFAULT_SETTINGS.removalComment,
    enableRemovalComments: enableRemovalComments ?? DEFAULT_SETTINGS.enableRemovalComments,
  };
}

/** Format a removal reason comment, replacing {reason} placeholder. */
export function formatRemovalComment(template: string, reason: string): string {
  return template.replace('{reason}', reason);
}
