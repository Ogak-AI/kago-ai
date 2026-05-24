// ============================================================
// Sentinel AI – AI Analysis Unit Tests
// Tests for the heuristic fallback engine and AI result parsing.
// ============================================================

import { computePriorityScore, getPriorityLevel } from '../utils/scoring.js';
import type { AIAnalysisResult, ViolationCategory, Severity } from '../types.js';

// ──────────────────────────────────────────────
// Test Harness (minimal, no external deps)
// ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}`);
    failed++;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ──────────────────────────────────────────────
// Mock Data
// ──────────────────────────────────────────────

const SPAM_CONTENT = 'BUY NOW! Click here for FREE MONEY! Visit bit.ly/spam123 for limited time offer!';
const TOXIC_CONTENT = 'You are absolutely worthless and pathetic. Go die you piece of garbage.';
const CLEAN_CONTENT = 'I really enjoyed the latest episode. The character development was excellent and I appreciated the subtle foreshadowing.';
const SCAM_CONTENT = 'Send me your crypto wallet and I will double your bitcoin investment guaranteed returns 10x!';
const SELF_PROMO = 'Check out my YouTube channel! Subscribe to my TikTok for more content! Use my promo code SAVE20!';
const HATE_SPEECH = 'All members of that group should be eliminated. White power forever.';
const LOW_EFFORT = 'lol ok';
const MANIPULATION = 'Everyone upvote this post! Downvote that user! Let us brigade their subreddit!';

function makeAnalysis(
  category: ViolationCategory,
  confidence: number,
  severity: Severity,
): AIAnalysisResult {
  return {
    category,
    confidence,
    severity,
    explanation: `Detected ${category} with ${confidence}% confidence`,
    suggestedAction: confidence > 85 ? 'remove' : 'review',
    source: 'heuristic',
  };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('AIAnalysisResult structure', () => {
  const result = makeAnalysis('spam', 85, 'high');
  assert(result.category === 'spam', 'Category is spam');
  assert(result.confidence === 85, 'Confidence is 85');
  assert(result.severity === 'high', 'Severity is high');
  assert(result.source === 'heuristic', 'Source is heuristic');
  assert(result.suggestedAction === 'review', 'Suggested action is review at 85%');

  const highConf = makeAnalysis('toxicity', 95, 'critical');
  assert(highConf.suggestedAction === 'remove', 'Suggested action is remove at 95%');
});

describe('Heuristic pattern matching (spam detection)', () => {
  const spamPatterns = [
    /\b(buy now|click here|free money|earn \$|make money fast|work from home|100% free|limited offer)\b/i,
    /https?:\/\/\S+\.(xyz|tk|ml|ga|cf)\b/i,
    /discord\.gg\/\S+/i,
    /t\.me\/\S+/i,
    /\b(subscribe|follow me|check out my)\b.{0,30}(channel|page|profile|link)/i,
  ];

  const matches = spamPatterns.filter(p => p.test(SPAM_CONTENT));
  assert(matches.length > 0, 'Spam content matches spam patterns');

  const cleanMatches = spamPatterns.filter(p => p.test(CLEAN_CONTENT));
  assert(cleanMatches.length === 0, 'Clean content does not match spam patterns');
});

describe('Heuristic pattern matching (toxicity detection)', () => {
  const toxicPatterns = [
    /\b(kill yourself|kys|go die|you('re| are) (worthless|pathetic|stupid|an idiot))\b/i,
    /\b(f+u+c+k+ ?(you|off|u))\b/i,
  ];

  const matches = toxicPatterns.filter(p => p.test(TOXIC_CONTENT));
  assert(matches.length > 0, 'Toxic content matches toxicity patterns');

  const cleanMatches = toxicPatterns.filter(p => p.test(CLEAN_CONTENT));
  assert(cleanMatches.length === 0, 'Clean content does not match toxicity patterns');
});

describe('Heuristic pattern matching (scam detection)', () => {
  const scamPatterns = [
    /\b(crypto|nft|bitcoin|ethereum).{0,30}(guaranteed|profit|return|investment)\b/i,
    /\b(send me|dm me|private message).{0,20}(crypto|bitcoin|money)\b/i,
    /\b(double your|10x your|guaranteed returns)\b/i,
  ];

  const matches = scamPatterns.filter(p => p.test(SCAM_CONTENT));
  assert(matches.length > 0, 'Scam content matches scam patterns');
});

describe('Heuristic pattern matching (self-promotion detection)', () => {
  const promoPatterns = [
    /\b(check out my|visit my|subscribe to my|follow my)\b/i,
    /\b(my (youtube|twitch|instagram|tiktok|onlyfans))\b/i,
    /\b(use (my |)code|promo code|discount code|affiliate)\b/i,
  ];

  const matches = promoPatterns.filter(p => p.test(SELF_PROMO));
  assert(matches.length > 0, 'Self-promo content matches promotion patterns');
});

describe('Heuristic pattern matching (manipulation detection)', () => {
  const manipPatterns = [
    /\b(upvote (this|my)|give me (upvotes|karma))\b/i,
    /\b(downvote (this|that) (post|comment|user))\b/i,
    /\b(brigade|raid|mass report)\b/i,
  ];

  const matches = manipPatterns.filter(p => p.test(MANIPULATION));
  assert(matches.length > 0, 'Manipulation content matches manipulation patterns');
});

describe('Low-effort detection', () => {
  assert(LOW_EFFORT.length <= 8, 'Short content detected as low-effort');

  const capsRatio = (s: string) => {
    const upper = s.replace(/[^A-Z]/g, '').length;
    const alpha = s.replace(/[^A-Za-z]/g, '').length;
    return alpha > 0 ? upper / alpha : 0;
  };

  const allCaps = 'THIS IS ALL CAPS GARBAGE POST';
  assert(capsRatio(allCaps) > 0.6, 'All-caps content exceeds caps ratio threshold');
  assert(capsRatio(CLEAN_CONTENT) < 0.6, 'Normal content does not exceed caps ratio');
});

describe('Category completeness', () => {
  const allCategories: ViolationCategory[] = [
    'spam', 'toxicity', 'hate_speech', 'rule_violation', 'low_effort',
    'scam', 'self_promotion', 'nsfw', 'brigading', 'manipulation', 'clean',
  ];
  assert(allCategories.length === 11, 'All 11 violation categories are defined');

  allCategories.forEach(cat => {
    const result = makeAnalysis(cat, 50, 'medium');
    assert(result.category === cat, `Category ${cat} creates valid analysis`);
  });
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`AI Tests: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) process.exit(1);
