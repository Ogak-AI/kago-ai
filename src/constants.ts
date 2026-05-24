// ============================================================
// Kago AI – Constants & Redis Key Builders
// All configuration values, weights, thresholds, and patterns.
// ============================================================

import type { Severity } from './types.js';

// ──────────────────────────────────────────────
// Redis Key Builders
// All keys are namespaced under 'kago:' to avoid collisions.
// ──────────────────────────────────────────────

export const Keys = {
  /** Sorted set: member=itemId, score=priorityScore (high = urgent) */
  queue: (subredditId: string) => `kago:queue:${subredditId}`,

  /** Hash: all FlaggedItem fields */
  item: (itemId: string) => `kago:item:${itemId}`,

  /** Hash: all UserReputation fields */
  user: (subredditId: string, userId: string) =>
    `kago:user:${subredditId}:${userId}`,

  /** Hash: KagoMetrics */
  metrics: (subredditId: string) => `kago:metrics:${subredditId}`,

  /** String "1" with TTL 24h — deduplication guard */
  processed: (itemId: string) => `kago:processed:${itemId}`,

  /** Sorted set: ModOverride JSON strings ordered by timestamp */
  overrides: (subredditId: string) => `kago:overrides:${subredditId}`,

  /** String: postId of pinned dashboard post */
  dashboardPost: (subredditId: string) => `kago:dashboard:${subredditId}`,

  /** Hash: cached settings per subreddit */
  settingsCache: (subredditId: string) => `kago:settings:${subredditId}`,

  /** Sorted set of user IDs by risk (score = 100 - trustScore) */
  userRiskSet: (subredditId: string) => `kago:userrisk:${subredditId}`,

  /**
   * Sorted set: member=timestamp_itemId, score=epochMs.
   * Tracks violations per user in a rolling 24h window.
   */
  userViolationWindow: (subredditId: string, userId: string) =>
    `kago:vwin:${subredditId}:${userId}`,

  /** JSON string: SubredditRule[] defined by mods */
  customRules: (subredditId: string) => `kago:rules:${subredditId}`,

  /** Sorted set: member=JSON audit entry, score=timestamp. Rolling action audit log. */
  audit: (subredditId: string) => `kago:audit:${subredditId}`,

  /** Hash: per-category adaptive thresholds */
  thresholds: (subredditId: string) => `kago:thresholds:${subredditId}`,

  /** String: daily content volume counter for cost estimation */
  dailyVolume: (subredditId: string, date: string) => `kago:volume:${subredditId}:${date}`,

  /** String: OpenAI daily call counter (rate limiter) */
  openaiCalls: (subredditId: string, date: string) => `kago:openai_calls:${subredditId}:${date}`,

  /** Adaptive learning state JSON */
  adaptive: (subredditId: string) => `kago:adaptive:${subredditId}`,

  /** Rule hit counter hash: field=ruleId, value=count */
  ruleHits: (subredditId: string) => `kago:rulehits:${subredditId}`,

  /** String: cached AI analysis result for dedup */
  analysisCache: (contentHash: string) => `kago:aicache:${contentHash}`,

  /** Rate limiter daily key */
  rateLimit: (subredditId: string) => `kago:ratelimit:${subredditId}:${new Date().toISOString().slice(0, 10)}`,

  /** Cumulative cost tracker */
  cost: (subredditId: string) => `kago:cost:${subredditId}`,
};


// ──────────────────────────────────────────────
// Priority Scoring Weights (matches spec formula)
// ──────────────────────────────────────────────

/**
 * Priority score formula:
 *   (AI confidence × 0.35) + (severity × 0.25) + (report count × 0.15)
 *   + (user risk × 0.15) + (recency × 0.10)
 */
export const PRIORITY_WEIGHTS = {
  AI_CONFIDENCE: 0.35,
  SEVERITY: 0.25,
  REPORT_COUNT: 0.15,
  USER_RISK: 0.15,
  RECENCY: 0.10,
} as const;

/** Severity numeric values for priority computation */
export const SEVERITY_SCORES: Record<Severity, number> = {
  critical: 100,
  high: 85,
  medium: 60,
  low: 30,
};

/** Priority level thresholds */
export const CRITICAL_PRIORITY_THRESHOLD = 85;
export const HIGH_PRIORITY_THRESHOLD = 65;
export const MEDIUM_PRIORITY_THRESHOLD = 40;


// ──────────────────────────────────────────────
// Trust Score Adjustments
// ──────────────────────────────────────────────

export const TRUST = {
  INITIAL_SCORE: 50,
  VIOLATION_PENALTY: -12,
  REMOVAL_PENALTY: -8,
  BAN_PENALTY: -25,
  SPAM_PENALTY: -15,
  APPROVAL_BONUS: 4,
  KARMA_BONUS_PER_1K: 0.5,        // capped at 20
  ACCOUNT_AGE_BONUS_PER_30D: 1,   // capped at 15
  /** Daily decay rate for violations older than 30 days */
  DECAY_RATE_PER_DAY: 0.02,
  /** Recovery bonus per 7 clean days */
  RECOVERY_BONUS: 2,
  /** False positive forgiveness: restore points when mod overrides */
  FALSE_POSITIVE_RECOVERY: 8,
  MIN_SCORE: 0,
  MAX_SCORE: 100,
} as const;

// ──────────────────────────────────────────────
// Queue / Storage Limits
// ──────────────────────────────────────────────

/** Max items kept in the priority queue sorted set */
export const MAX_QUEUE_SIZE = 500;

/** Max override log entries kept per subreddit */
export const MAX_OVERRIDE_LOG = 500;

/** Max audit log entries kept per subreddit */
export const MAX_AUDIT_LOG = 500;

/** How long a processed-dedup key lives (24 hours in seconds) */
export const PROCESSED_TTL_SECONDS = 86400;

/** How long pending queue items are kept before being auto-expired (48h, ms) */
export const QUEUE_ITEM_TTL_MS = 172800000;

/** Max characters of post/comment body stored in Redis */
export const MAX_BODY_STORED = 600;

/** Rolling violation window for temporal escalation (24 hours in ms) */
export const VIOLATION_WINDOW_MS = 86400000;

/** Number of violations within the window that triggers auto-ban */
export const AUTO_BAN_VIOLATION_THRESHOLD = 3;

/** Duration of a temporary auto-ban (days) */
export const AUTO_BAN_DURATION_DAYS = 7;

/** TTL for cached AI analysis results (1 hour in seconds) */
export const AI_CACHE_TTL_SECONDS = 3600;


// ──────────────────────────────────────────────
// AI Service
// ──────────────────────────────────────────────

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_AI_MODEL = 'gpt-4o-mini';

/** Max tokens returned by AI analysis */
export const AI_MAX_TOKENS = 300;

/** Temperature for AI moderation (low = deterministic) */
export const AI_TEMPERATURE = 0.1;

/** Request timeout for OpenAI calls (ms) */
export const AI_TIMEOUT_MS = 8000;

/** Maximum retry attempts for AI calls */
export const AI_MAX_RETRIES = 2;

/** Delay between retries (ms) */
export const AI_RETRY_DELAY_MS = 1000;


// ──────────────────────────────────────────────
// Heuristic Engine Patterns
// ──────────────────────────────────────────────

export const SPAM_PATTERNS = [
  /\b(buy now|click here|free money|earn \$|make money fast|work from home|100% free|limited offer)\b/i,
  /https?:\/\/\S+\.(xyz|tk|ml|ga|cf)\b/i,
  /discord\.gg\/\S+/i,
  /t\.me\/\S+/i,
  /\b(subscribe|follow me|check out my)\b.{0,30}(channel|page|profile|link)/i,
];

export const TOXICITY_PATTERNS = [
  /\b(kill yourself|kys|go die|you('re| are) (worthless|pathetic|stupid|an idiot))\b/i,
  /\b(f+u+c+k+ ?(you|off|u))\b/i,
  /\b(n[i1]+g+[e3]+r|f+[a@]+g+[o0]+t|r[e3]+t[a@]+rd)\b/i,
];

export const HATE_SPEECH_PATTERNS = [
  /\b(all (muslims|jews|christians|blacks|whites|asians|hispanics) (are|should be))\b/i,
  /\b(white (power|supremacy|pride|lives matter only))\b/i,
  /\b(death to (all )?)\w+/i,
];

export const SCAM_PATTERNS = [
  /\b(crypto|nft|bitcoin|ethereum).{0,30}(guaranteed|profit|return|investment)\b/i,
  /\b(send me|dm me|private message).{0,20}(crypto|bitcoin|money)\b/i,
  /\b(giveaway|airdrop).{0,30}(send|deposit|wallet)\b/i,
  /\b(double your|10x your|guaranteed returns)\b/i,
];

export const SELF_PROMO_PATTERNS = [
  /\b(check out my|visit my|subscribe to my|follow my)\b/i,
  /\b(my (youtube|twitch|instagram|tiktok|onlyfans))\b/i,
  /\b(use (my |)code|promo code|discount code|affiliate)\b/i,
];

export const MANIPULATION_PATTERNS = [
  /\b(upvote (this|my)|give me (upvotes|karma))\b/i,
  /\b(downvote (this|that) (post|comment|user))\b/i,
  /\b(brigade|raid|mass report)\b/i,
];

/** Ratio of uppercase chars that triggers low-effort / rage flag */
export const CAPS_RATIO_THRESHOLD = 0.6;

/** Min body length for "low effort" detection */
export const LOW_EFFORT_MAX_LENGTH = 8;


// ──────────────────────────────────────────────
// Scheduler Job Names
// ──────────────────────────────────────────────

export const JOBS = {
  CLEANUP_QUEUE: 'kago_cleanup_queue',
  METRICS_ROLLUP: 'kago_metrics_rollup',
  THRESHOLD_RECALC: 'kago_threshold_recalc',
  REPUTATION_DECAY: 'kago_reputation_decay',
  RETRAINING: 'kago_retraining',
} as const;

/** Default daily API call limit */
export const DEFAULT_DAILY_API_LIMIT = 500;

/** Estimated cost per API call in USD (GPT-4o-mini) */
export const ESTIMATED_COST_PER_CALL = 0.00015;


// ──────────────────────────────────────────────
// Default Settings
// ──────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  openaiApiKey: '',
  aiModel: DEFAULT_AI_MODEL,
  autoRemoveThreshold: 92,
  dailyApiLimit: 500,
  autoApproveTrustedUsers: true,
  trustedUserThreshold: 80,
  lowTrustThreshold: 25,
  bannedKeywords: [] as string[],
  subredditRules: '1. Be respectful\n2. No spam\n3. No self-promotion\n4. Stay on topic',
  removalComment:
    'Your post/comment was automatically removed by Kago AI for the following reason: {reason}. If you believe this was a mistake, please message the moderators.',
  enableRemovalComments: true,
} as const;

/** Default per-category thresholds */
export const DEFAULT_CATEGORY_THRESHOLDS: Record<string, number> = {
  spam: 92,
  toxicity: 92,
  hate_speech: 88,
  scam: 90,
  rule_violation: 92,
  self_promotion: 92,
  nsfw: 90,
  brigading: 85,
  manipulation: 88,
};
