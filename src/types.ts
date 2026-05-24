// ============================================================
// Kago AI – Shared Type Definitions
// Complete type system for the moderation platform.
// ============================================================

// ──────────────────────────────────────────────
// Violation / Action Enums
// ──────────────────────────────────────────────

export type ViolationCategory =
  | 'spam'
  | 'toxicity'
  | 'rule_violation'
  | 'low_effort'
  | 'scam'
  | 'hate_speech'
  | 'self_promotion'
  | 'nsfw'
  | 'brigading'
  | 'manipulation'
  | 'clean';

export type SuggestedAction = 'remove' | 'approve' | 'review' | 'ban';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';

export type ContentType = 'post' | 'comment';

export type ItemStatus =
  | 'pending'
  | 'auto_removed'
  | 'auto_approved'
  | 'auto_banned'
  | 'mod_approved'
  | 'mod_removed'
  | 'mod_banned'
  | 'ignored';

export type ReputationTier =
  | 'trusted'      // 80–100
  | 'established'  // 60–79
  | 'neutral'      // 40–59
  | 'suspicious'   // 25–39
  | 'untrusted';   // 0–24

export type RiskLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical';

// ──────────────────────────────────────────────
// Custom Rule Engine
// ──────────────────────────────────────────────

export type RuleType = 'keyword' | 'regex' | 'user' | 'domain';

/** A custom rule defined by moderators, evaluated before AI analysis. */
export interface SubredditRule {
  id: string;
  name: string;
  type?: RuleType;
  keywords: string[];
  regexPatterns?: string[];
  targetUsers?: string[];
  blockedDomains?: string[];
  threshold: number;
  action: 'remove' | 'review' | 'ban';
  severity?: Severity;
  reason: string;
  enabled: boolean;
  priority?: number;
  hitCount?: number;
  createdAt?: number;
}

// ──────────────────────────────────────────────
// Decision Engine Result
// ──────────────────────────────────────────────

/** The output of the Decision Engine — a definitive action decision. */
export interface DecisionResult {
  /** The final action to take */
  action:
    | 'auto_remove'
    | 'auto_approve'
    | 'auto_ban_temp'
    | 'enqueue_critical'
    | 'enqueue_high'
    | 'enqueue_medium'
    | 'enqueue_low'
    | 'skip';
  /** Human-readable explanation of WHY this decision was made */
  reason: string;
  /** Whether this decision requires a moderator to review it */
  requiresModReview: boolean;
  /** The severity level used in the decision */
  severity: Severity;
  /** Which rule triggered this (if custom rule engine) */
  triggeredRule?: string;
  /** Which decision layer made this call */
  decisionLayer?: string;
  /** Confidence score from analysis */
  confidence?: number;
  /** Recommended next step for moderator */
  recommendedNextStep?: string;
}

// ──────────────────────────────────────────────
// AI Analysis Result
// ──────────────────────────────────────────────

export interface AIAnalysisResult {
  /** Primary violation category detected */
  category: ViolationCategory;
  /** AI confidence score 0–100 */
  confidence: number;
  /** Severity of the violation */
  severity: Severity;
  /** Short human-readable explanation */
  explanation: string;
  /** What the AI recommends the moderator do */
  suggestedAction: SuggestedAction;
  /** Was this result from the OpenAI API or the local heuristic fallback? */
  source: 'openai' | 'heuristic';
  /** Risk summary for display */
  riskSummary?: string;
  /** Secondary categories detected */
  secondaryCategories?: ViolationCategory[];
}

// ──────────────────────────────────────────────
// Flagged Queue Item
// ──────────────────────────────────────────────

export interface FlaggedItem {
  /** Reddit fullname: t3_xxx (post) or t1_xxx (comment) */
  id: string;
  type: ContentType;

  // Content
  title?: string;
  body: string;
  authorName: string;
  authorId: string;
  permalink: string;
  subredditId: string;
  subredditName: string;
  createdAt: number; // epoch ms

  // AI Analysis
  category: ViolationCategory;
  confidence: number;
  severity: Severity;
  explanation: string;
  suggestedAction: SuggestedAction;
  analysisSource: 'openai' | 'heuristic';
  riskSummary?: string;
  /** Decision Engine output — why the system decided what it did */
  decisionReason?: string;
  /** Which decision layer triggered */
  decisionLayer?: string;
  /** Which custom rule triggered this flag, if any */
  triggeredRule?: string;

  // Queue
  priorityScore: number; // 0–100 composite score used in sorted set
  priorityLevel: PriorityLevel;
  reportCount?: number;

  // Status
  status: ItemStatus;
  resolvedBy?: string; // moderator username
  resolvedAt?: number; // epoch ms
  resolution?: string; // brief note on resolution
}

// ──────────────────────────────────────────────
// User Reputation
// ──────────────────────────────────────────────

export interface UserReputation {
  userId: string;
  username: string;
  subredditId: string;
  trustScore: number;
  riskLevel?: RiskLevel;
  tier?: ReputationTier;
  violations: number;
  approvals: number;
  bans?: number;
  spamCount?: number;
  accountAgeDays: number;
  karma: number;
  approvalRatio?: number;
  recentViolations24h?: number;
  lastViolationAt?: number;
  overrideCount?: number;
  lastUpdated: number;
}

// ──────────────────────────────────────────────
// Moderator Override (for adaptive learning)
// ──────────────────────────────────────────────

export interface ModOverride {
  itemId: string;
  originalCategory: ViolationCategory;
  originalConfidence: number;
  originalAction?: SuggestedAction;
  modAction: ItemStatus;
  modUsername: string;
  timestamp: number;
  isFalsePositive?: boolean;
  isFalseNegative?: boolean;
}

// ──────────────────────────────────────────────
// Audit Log Entry
// ──────────────────────────────────────────────

export interface AuditEntry {
  id?: string;
  timestamp: number;
  actionType: 'auto_remove' | 'auto_approve' | 'auto_ban' | 'manual_remove' | 'manual_approve' | 'manual_ban' | 'manual_ignore' | 'batch' | 'restore' | 'rule_update';
  contentId: string;
  contentType: 'post' | 'comment';
  contentSnippet: string;
  authorName: string;
  aiCategory: string;
  aiConfidence: number;
  severity?: Severity;
  triggeredBy: string;
  reason: string;
  reversible?: boolean;
  reversed?: boolean;
}

// ──────────────────────────────────────────────
// App Metrics
// ──────────────────────────────────────────────

export interface KagoMetrics {
  subredditId: string;
  totalScanned: number;
  autoRemoved: number;
  autoApproved: number;
  autoBanned: number;
  manuallyApproved: number;
  manuallyRemoved: number;
  falsePositives: number;
  falseNegatives: number;
  spamCount: number;
  toxicityCount: number;
  ruleViolationCount: number;
  lowEffortCount: number;
  scamCount: number;
  hateSpeechCount: number;
  selfPromotionCount: number;
  nsfwCount: number;
  brigadingCount: number;
  manipulationCount: number;
  cleanCount: number;
  /** Average processing time in ms */
  avgProcessingTimeMs: number;
  /** Total processing time samples */
  processingTimeSamples: number;
  lastReset: number; // epoch ms
  lastUpdated: number;
}

// ──────────────────────────────────────────────
// App Settings (loaded from Devvit settings)
// ──────────────────────────────────────────────

export interface KagoSettings {
  openaiApiKey: string;
  aiModel: string;
  autoRemoveThreshold: number;
  dailyApiLimit?: number;
  autoApproveTrustedUsers: boolean;
  trustedUserThreshold: number;
  lowTrustThreshold: number;
  bannedKeywords: string[];
  subredditRules: string;
  removalComment: string;
  enableRemovalComments: boolean;
}

// ──────────────────────────────────────────────
// Dashboard Message Types (Blocks ↔ Webview)
// ──────────────────────────────────────────────

export type DashboardTab = 'queue' | 'users' | 'stats' | 'settings' | 'audit' | 'rules' | 'health' | 'insights';

export interface WebviewMessage {
  type:
    | 'INIT_DATA'
    | 'ACTION_REQUEST'
    | 'BATCH_ACTION'
    | 'RULES_SAVE'
    | 'SETTINGS_SAVE'
    | 'LOAD_MORE'
    | 'REFRESH'
    | 'AUDIT_RESTORE'
    | 'USER_SEARCH'
    | 'RULE_TEST';
  payload?: unknown;
}

/** Rate limit / API usage status sent to the dashboard */
export interface RateLimitInfo {
  todayCalls: number;
  dailyLimit: number;
  isRateLimited: boolean;
  estimatedCostToday: string;
  totalCost: string;
}

/** Per-category threshold tuning data for the Analytics tab */
export interface ThresholdTuningCategory {
  category: string;
  currentThreshold: number;
  defaultThreshold: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  adjustmentDelta: number;
  autoAdjusted: boolean;
}

export interface ThresholdTuningData {
  categories: ThresholdTuningCategory[];
  lastRecalculated: number;
}

/** Mode indicator for dashboard header */
export type AiModeStatus = 'ai_active' | 'heuristic_only' | 'rate_limited';

/** Derived stats computed from raw metrics */
export interface DerivedStats {
  autoModRate: number;
  timeSavedHours: number;
  falsePositiveRate: number;
  queueReductionEst: number;
  avgResponseTimeSec: number;
  moderatorEfficiencyScore: number;
  timeSavedToday: string;
}

/** @see SubredditHealthScore in services/health.service */
export interface HealthScorePayload {
  overall: number;
  categories: { contentSafety: number; modEfficiency: number; userHealth: number; responseTime: number; };
  trends: { toxicityTrend: string; spamTrend: string; modBurdenTrend: string; };
  riskIndicators: string[];
  recommendations: string[];
}

/** @see RaidAlert in services/raid.service */
export interface RaidAlertPayload {
  id: string;
  subredditId: string;
  detectedAt: number;
  itemCount: number;
  uniqueAuthors: number;
  categories: string[];
  severity: 'critical' | 'high' | 'medium';
  status: 'active' | 'resolved' | 'false_alarm';
}

/** @see ModerationSummary in services/summarizer.service */
export interface ModSummaryPayload {
  generatedAt: number;
  period: string;
  highlights: string[];
  notableEvents: string[];
}

export interface InitDataPayload {
  queueItems: FlaggedItem[];
  metrics: KagoMetrics;
  derived: DerivedStats;
  topUsers: UserReputation[];
  settings: Partial<KagoSettings>;
  customRules?: SubredditRule[];
  isModerator: boolean;
  currentUsername: string;
  auditLog?: AuditEntry[];
  rateLimitInfo?: RateLimitInfo;
  aiModeStatus?: AiModeStatus;
  thresholdTuning?: ThresholdTuningData;
  avgDailyVolume?: number;
  queueStats?: { total: number; critical: number; high: number; medium: number; low: number };
  healthScore?: HealthScorePayload;
  raidAlert?: RaidAlertPayload;
  moderationSummary?: ModSummaryPayload;
}


export interface ActionRequestPayload {
  itemId: string;
  action: 'approve' | 'remove' | 'ban' | 'ignore' | 'lock';
  note?: string;
}

/** Batch action: apply the same action to multiple items at once. */
export interface BatchActionPayload {
  itemIds: string[];
  action: 'approve' | 'remove' | 'ban' | 'ignore';
}

export interface SettingsSavePayload {
  settings: Partial<KagoSettings>;
}

export interface RulesSavePayload {
  rules: SubredditRule[];
}

export interface UserSearchPayload {
  query: string;
}

export interface RuleTestPayload {
  ruleId: string;
  testContent: string;
}
