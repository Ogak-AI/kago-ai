// ============================================================
// Sentinel AI – AI Analysis Service
// Tries OpenAI first; falls back to rule-based heuristics.
// ============================================================

import type { RedditAPIClient, RedisClient } from '@devvit/public-api';
import type { AIAnalysisResult, SentinelSettings, Severity, ViolationCategory } from '../types.js';
import { canMakeApiCall, recordApiCall } from './ratelimit.service.js';

import {
  AI_MAX_TOKENS,
  AI_TEMPERATURE,
  AI_TIMEOUT_MS,
  CAPS_RATIO_THRESHOLD,
  HATE_SPEECH_PATTERNS,
  LOW_EFFORT_MAX_LENGTH,
  OPENAI_ENDPOINT,
  SCAM_PATTERNS,
  SPAM_PATTERNS,
  TOXICITY_PATTERNS,
} from '../constants.js';

// ──────────────────────────────────────────────
// System Prompt Builder
// ──────────────────────────────────────────────

function buildSystemPrompt(settings: SentinelSettings): string {
  return `You are Sentinel AI, a Reddit content moderation assistant.

Your job is to analyze Reddit posts and comments and determine if they violate community rules.

SUBREDDIT RULES:
${settings.subredditRules}

BANNED KEYWORDS: ${settings.bannedKeywords.length > 0 ? settings.bannedKeywords.join(', ') : 'None defined'}

You MUST respond with ONLY valid JSON in this exact format:
{
  "category": "<spam|toxicity|rule_violation|low_effort|scam|hate_speech|clean>",
  "confidence": <0-100 integer>,
  "explanation": "<1-2 sentence human-readable explanation, max 100 chars>",
  "suggestedAction": "<remove|approve|review|ban>"
}

GUIDELINES:
- "spam": Promotional content, bots, repetitive posts, affiliate links
- "toxicity": Personal attacks, harassment, profanity directed at users
- "rule_violation": Breaks the listed subreddit rules above
- "low_effort": Content with essentially no substance (e.g. "lol", "this", single emojis)
- "scam": Crypto scams, phishing, get-rich-quick schemes
- "hate_speech": Content targeting race, religion, gender, sexuality with hostility
- "clean": Content appears to be fine
- confidence: How certain you are (0=no idea, 100=absolutely certain)
- suggestedAction: "ban" only for severe/repeat violations, "remove" for clear violations, "review" for borderline, "approve" for clean
- Be concise. Be accurate. Avoid false positives on borderline content.`;
}

function buildUserPrompt(
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
  authorName: string,
): string {
  const lines: string[] = [
    `TYPE: ${contentType.toUpperCase()}`,
    `AUTHOR: u/${authorName}`,
  ];
  if (contentType === 'post' && title) {
    lines.push(`TITLE: ${title}`);
  }
  lines.push(`CONTENT: ${body.slice(0, 1500)}`);
  return lines.join('\n');
}

// ──────────────────────────────────────────────
// OpenAI Call
// ──────────────────────────────────────────────

async function callOpenAI(
  settings: SentinelSettings,
  systemPrompt: string,
  userPrompt: string,
): Promise<AIAnalysisResult | null> {
  if (!settings.openaiApiKey) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    const response = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.aiModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: AI_MAX_TOKENS,
        temperature: AI_TEMPERATURE,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[Sentinel] OpenAI error ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      category: ViolationCategory;
      confidence: number;
      severity?: Severity;
      explanation: string;
      suggestedAction: string;
    };

    // Derive severity if AI didn't provide it
    const severity: Severity = parsed.severity ?? (
      parsed.confidence >= 80 ? 'high' : parsed.confidence >= 55 ? 'medium' : 'low'
    );

    return {
      category: parsed.category ?? 'clean',
      confidence: Math.max(0, Math.min(100, Math.round(parsed.confidence ?? 0))),
      severity,
      explanation: (parsed.explanation ?? '').slice(0, 120),
      suggestedAction:
        (parsed.suggestedAction as AIAnalysisResult['suggestedAction']) ?? 'review',
      source: 'openai',
    };

  } catch (err) {
    console.error('[Sentinel] OpenAI call failed:', err);
    return null;
  }
}

// ──────────────────────────────────────────────
// Heuristic Fallback Engine
// ──────────────────────────────────────────────

function runHeuristics(
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
  settings: SentinelSettings,
): AIAnalysisResult {
  const fullText = [title ?? '', body].join(' ').toLowerCase();
  const originalText = [title ?? '', body].join(' ');

  // Banned keywords (exact, case-insensitive)
  for (const kw of settings.bannedKeywords) {
    if (kw && fullText.includes(kw.toLowerCase())) {
      return {
        category: 'rule_violation',
        confidence: 95,
        severity: 'high',
        explanation: `Contains banned keyword: "${kw}"`,
        suggestedAction: 'remove',
        source: 'heuristic',
      };
    }
  }

  // Hate speech
  for (const pattern of HATE_SPEECH_PATTERNS) {
    if (pattern.test(originalText)) {
      return {
        category: 'hate_speech',
        confidence: 88,
        severity: 'high',
        explanation: 'Content contains hate speech targeting a group.',
        suggestedAction: 'ban',
        source: 'heuristic',
      };
    }
  }

  // Toxicity
  for (const pattern of TOXICITY_PATTERNS) {
    if (pattern.test(originalText)) {
      return {
        category: 'toxicity',
        confidence: 85,
        severity: 'high',
        explanation: 'Content contains toxic language or personal attacks.',
        suggestedAction: 'remove',
        source: 'heuristic',
      };
    }
  }

  // Scam
  for (const pattern of SCAM_PATTERNS) {
    if (pattern.test(originalText)) {
      return {
        category: 'scam',
        confidence: 82,
        severity: 'high',
        explanation: 'Content matches known scam/crypto spam patterns.',
        suggestedAction: 'remove',
        source: 'heuristic',
      };
    }
  }

  // Spam
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(originalText)) {
      return {
        category: 'spam',
        confidence: 80,
        severity: 'medium',
        explanation: 'Content matches spam patterns (links, promotions).',
        suggestedAction: 'remove',
        source: 'heuristic',
      };
    }
  }

  // Low-effort
  const trimmedBody = body.trim();
  if (trimmedBody.length > 0 && trimmedBody.length <= LOW_EFFORT_MAX_LENGTH) {
    return {
      category: 'low_effort',
      confidence: 60,
      severity: 'low',
      explanation: 'Content is extremely short and offers no value.',
      suggestedAction: 'review',
      source: 'heuristic',
    };
  }

  // Caps rage detection
  const letters = originalText.replace(/[^a-zA-Z]/g, '');
  if (letters.length > 20) {
    const capsRatio = (originalText.replace(/[^A-Z]/g, '').length) / letters.length;
    if (capsRatio > CAPS_RATIO_THRESHOLD) {
      return {
        category: 'toxicity',
        confidence: 55,
        severity: 'medium',
        explanation: 'Content is written almost entirely in capital letters.',
        suggestedAction: 'review',
        source: 'heuristic',
      };
    }
  }

  // Clean
  return {
    category: 'clean',
    confidence: 85,
    severity: 'low',
    explanation: 'No rule violations detected.',
    suggestedAction: 'approve',
    source: 'heuristic',
  };
}


// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Analyze a post or comment. Tries OpenAI first, falls back to heuristics.
 */
export async function analyzeContent(
  contentType: 'post' | 'comment',
  title: string | undefined,
  body: string,
  authorName: string,
  settings: SentinelSettings,
  _reddit?: RedditAPIClient,
  redis?: RedisClient,
  subredditId?: string,
): Promise<AIAnalysisResult> {
  const systemPrompt = buildSystemPrompt(settings);
  const userPrompt = buildUserPrompt(contentType, title, body, authorName);

  // Try OpenAI (with rate limiting)
  if (settings.openaiApiKey) {
    // Check rate limit if Redis is available
    let rateLimited = false;
    if (redis && subredditId) {
      rateLimited = !(await canMakeApiCall(redis, subredditId));
      if (rateLimited) {
        console.warn('[Sentinel] Rate limited — falling back to heuristics');
      }
    }

    if (!rateLimited) {
      const aiResult = await callOpenAI(settings, systemPrompt, userPrompt);
      if (aiResult) {
        // Record the API call for cost tracking
        if (redis && subredditId) {
          await recordApiCall(redis, subredditId).catch(() => {});
        }
        return aiResult;
      }
    }
  }

  // Fallback: heuristics
  return runHeuristics(contentType, title, body, settings);
}
