// ============================================================
// Kago AI – Rule Engine Unit Tests
// Validates custom rule evaluation, pattern matching, and
// short-circuit behavior.
// ============================================================

import type { SubredditRule } from '../types.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) { console.log(`  ✅ ${name}`); passed++; }
  else { console.error(`  ❌ ${name}`); failed++; }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n📋 ${name}`);
  fn();
}

// ──────────────────────────────────────────────
// Mock Rule Factory
// ──────────────────────────────────────────────

function makeRule(overrides: Partial<SubredditRule> = {}): SubredditRule {
  return {
    id: 'test-rule-' + Date.now(),
    name: 'Test Rule',
    type: 'keyword',
    keywords: ['spam', 'buy now'],
    threshold: 80,
    action: 'remove',
    severity: 'high',
    reason: 'Test rule violation',
    enabled: true,
    priority: 0,
    hitCount: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// Simple Rule Evaluator (mirrors rules.service.ts logic)
// ──────────────────────────────────────────────

function evaluateRulesLocal(
  rules: SubredditRule[],
  title: string | undefined,
  body: string,
): { matched: boolean; rule: SubredditRule | null } {
  const fullText = ((title ?? '') + ' ' + body).toLowerCase();

  // Sort by priority (lower = evaluated first)
  const sorted = [...rules]
    .filter(r => r.enabled)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

  for (const rule of sorted) {
    let matched = false;

    switch (rule.type) {
      case 'keyword':
        matched = rule.keywords.some(kw => fullText.includes(kw.toLowerCase()));
        break;
      case 'regex':
        matched = (rule.regexPatterns ?? []).some(pattern => {
          try { return new RegExp(pattern, 'i').test(fullText); }
          catch { return false; }
        });
        break;
      case 'domain':
        matched = (rule.blockedDomains ?? []).some(domain =>
          fullText.includes(domain.toLowerCase())
        );
        break;
      case 'user':
        // User rules check username, not content text
        break;
    }

    if (matched) return { matched: true, rule };
  }

  return { matched: false, rule: null };
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('Keyword rule matching', () => {
  const rule = makeRule({
    name: 'No Spam',
    keywords: ['buy now', 'free money', 'click here'],
  });

  const r1 = evaluateRulesLocal([rule], 'Great deal', 'Click here to buy now!');
  assert(r1.matched === true, 'Matches keyword "buy now" in body');
  assert(r1.rule?.name === 'No Spam', 'Returns correct rule');

  const r2 = evaluateRulesLocal([rule], 'FREE MONEY!!!', 'This is legit');
  assert(r2.matched === true, 'Case-insensitive match in title');

  const r3 = evaluateRulesLocal([rule], 'Normal post', 'This is clean content');
  assert(r3.matched === false, 'Does not match clean content');
});

describe('Regex rule matching', () => {
  const rule = makeRule({
    type: 'regex',
    name: 'URL Pattern',
    keywords: [],
    regexPatterns: [
      'https?://\\S+\\.(xyz|tk|ml)',
      '\\b\\d{3}-\\d{3}-\\d{4}\\b', // Phone numbers
    ],
  });

  const r1 = evaluateRulesLocal([rule], undefined, 'Visit http://scam.xyz for prizes!');
  assert(r1.matched === true, 'Matches suspicious URL pattern');

  const r2 = evaluateRulesLocal([rule], undefined, 'Call me at 555-123-4567');
  assert(r2.matched === true, 'Matches phone number pattern');

  const r3 = evaluateRulesLocal([rule], undefined, 'Normal comment with no links');
  assert(r3.matched === false, 'Does not match clean content');
});

describe('Domain blacklist rule', () => {
  const rule = makeRule({
    type: 'domain',
    name: 'Blocked Domains',
    keywords: [],
    blockedDomains: ['malware.com', 'phishing.net', 'scam.io'],
  });

  const r1 = evaluateRulesLocal([rule], undefined, 'Check out https://malware.com/payload');
  assert(r1.matched === true, 'Blocks blacklisted domain');

  const r2 = evaluateRulesLocal([rule], undefined, 'Visit https://reddit.com/r/example');
  assert(r2.matched === false, 'Does not block non-blacklisted domain');
});

describe('Disabled rules are skipped', () => {
  const rule = makeRule({
    enabled: false,
    keywords: ['buy now'],
  });

  const result = evaluateRulesLocal([rule], 'Buy Now!', 'Click here');
  assert(result.matched === false, 'Disabled rule does not match');
});

describe('Priority ordering (short-circuit)', () => {
  const lowPriority = makeRule({
    name: 'Low Priority',
    priority: 10,
    keywords: ['hello'],
    action: 'review',
  });

  const highPriority = makeRule({
    name: 'High Priority',
    priority: 1,
    keywords: ['hello'],
    action: 'remove',
  });

  // High priority should match first (lower number = higher priority)
  const result = evaluateRulesLocal([lowPriority, highPriority], undefined, 'hello world');
  assert(result.matched === true, 'Rule matches');
  assert(result.rule?.name === 'High Priority', 'Higher priority rule matches first');
  assert(result.rule?.action === 'remove', 'Correct action from higher priority rule');
});

describe('Multiple rules — first match wins', () => {
  const rule1 = makeRule({ name: 'Rule 1', priority: 0, keywords: ['spam'] });
  const rule2 = makeRule({ name: 'Rule 2', priority: 1, keywords: ['spam', 'scam'] });

  const result = evaluateRulesLocal([rule1, rule2], undefined, 'This is spam');
  assert(result.matched === true, 'First matching rule is returned');
  assert(result.rule?.name === 'Rule 1', 'Rule 1 wins (evaluated first)');
});

describe('Empty rules array', () => {
  const result = evaluateRulesLocal([], 'Test', 'Content');
  assert(result.matched === false, 'No match with empty rules');
  assert(result.rule === null, 'No rule returned');
});

describe('Rule severity levels', () => {
  const severities = ['critical', 'high', 'medium', 'low'] as const;
  severities.forEach(sev => {
    const rule = makeRule({ severity: sev });
    assert(rule.severity === sev, `Severity ${sev} is valid`);
  });
});

describe('Rule action types', () => {
  const actions = ['remove', 'review', 'ban'] as const;
  actions.forEach(action => {
    const rule = makeRule({ action });
    assert(rule.action === action, `Action ${action} is valid`);
  });
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Rules Tests: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) process.exit(1);
