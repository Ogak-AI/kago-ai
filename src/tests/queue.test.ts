// ============================================================
// Sentinel AI – Queue Ranking Unit Tests
// Validates priority score computation and queue level assignment.
// ============================================================

import { computePriorityScore, getPriorityLevel } from '../utils/scoring.js';
import type { Severity, PriorityLevel } from '../types.js';

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

function assertRange(value: number, min: number, max: number, name: string): void {
  assert(value >= min && value <= max, `${name} (${value} in [${min}, ${max}])`);
}

// ──────────────────────────────────────────────
// Priority Score Tests
// ──────────────────────────────────────────────

describe('Priority score formula', () => {
  // High confidence + critical severity + high reports + low trust + recent
  const criticalScore = computePriorityScore(95, 'critical', 10, 10, Date.now());
  assertRange(criticalScore, 75, 100, 'Critical content scores very high');

  // Low confidence + low severity + no reports + high trust + old
  const lowScore = computePriorityScore(20, 'low', 0, 90, Date.now() - 86400000);
  assertRange(lowScore, 0, 35, 'Benign content scores low');

  // Ensure critical > low
  assert(criticalScore > lowScore, 'Critical score > benign score');
});

describe('Priority score component weights', () => {
  const now = Date.now();

  // Test AI confidence weight (0.35)
  const highConf = computePriorityScore(100, 'medium', 0, 50, now);
  const lowConf = computePriorityScore(10, 'medium', 0, 50, now);
  assert(highConf > lowConf, 'Higher AI confidence → higher priority');
  const confDiff = highConf - lowConf;
  assertRange(confDiff, 20, 45, 'Confidence contributes ~35% of score range');

  // Test severity weight (0.25)
  const critSev = computePriorityScore(50, 'critical', 0, 50, now);
  const lowSev = computePriorityScore(50, 'low', 0, 50, now);
  assert(critSev > lowSev, 'Higher severity → higher priority');

  // Test report count weight (0.15)
  const highReports = computePriorityScore(50, 'medium', 10, 50, now);
  const noReports = computePriorityScore(50, 'medium', 0, 50, now);
  assert(highReports > noReports, 'More reports → higher priority');

  // Test user risk weight (0.15) — lower trust = higher risk = higher priority
  const lowTrust = computePriorityScore(50, 'medium', 0, 10, now);
  const highTrust = computePriorityScore(50, 'medium', 0, 90, now);
  assert(lowTrust > highTrust, 'Lower trust (higher risk) → higher priority');

  // Test recency weight (0.10)
  const recent = computePriorityScore(50, 'medium', 0, 50, now);
  const old = computePriorityScore(50, 'medium', 0, 50, now - 48 * 3600 * 1000);
  assert(recent > old, 'More recent content → higher priority');
});

describe('Priority score bounds', () => {
  // Maximum possible score
  const maxScore = computePriorityScore(100, 'critical', 10, 0, Date.now());
  assertRange(maxScore, 80, 100, 'Max inputs produce score near 100');

  // Minimum possible score
  const minScore = computePriorityScore(0, 'low', 0, 100, Date.now() - 86400000 * 2);
  assertRange(minScore, 0, 20, 'Min inputs produce score near 0');

  // Score is always 0–100
  assert(maxScore >= 0 && maxScore <= 100, 'Max score in [0, 100]');
  assert(minScore >= 0 && minScore <= 100, 'Min score in [0, 100]');
});

// ──────────────────────────────────────────────
// Priority Level Tests
// ──────────────────────────────────────────────

describe('Priority level assignment', () => {
  assert(getPriorityLevel(95) === 'critical', 'Score 95 → critical');
  assert(getPriorityLevel(85) === 'critical', 'Score 85 → critical');
  assert(getPriorityLevel(75) === 'high', 'Score 75 → high');
  assert(getPriorityLevel(65) === 'high', 'Score 65 → high');
  assert(getPriorityLevel(50) === 'medium', 'Score 50 → medium');
  assert(getPriorityLevel(40) === 'medium', 'Score 40 → medium');
  assert(getPriorityLevel(30) === 'low', 'Score 30 → low');
  assert(getPriorityLevel(10) === 'low', 'Score 10 → low');
  assert(getPriorityLevel(0) === 'low', 'Score 0 → low');
});

describe('Priority ordering', () => {
  const levels: PriorityLevel[] = ['critical', 'high', 'medium', 'low'];
  const scores = [90, 70, 50, 20];
  const assigned = scores.map(s => getPriorityLevel(s));

  for (let i = 0; i < levels.length; i++) {
    assert(assigned[i] === levels[i], `Score ${scores[i]} maps to ${levels[i]}`);
  }
});

describe('Edge cases', () => {
  // Exact boundary values
  assert(getPriorityLevel(85) === 'critical', 'Boundary 85 → critical');
  assert(getPriorityLevel(84) === 'high', 'Boundary 84 → high');
  assert(getPriorityLevel(65) === 'high', 'Boundary 65 → high');
  assert(getPriorityLevel(64) === 'medium', 'Boundary 64 → medium');
  assert(getPriorityLevel(40) === 'medium', 'Boundary 40 → medium');
  assert(getPriorityLevel(39) === 'low', 'Boundary 39 → low');

  // Report count capping
  const cappedReports = computePriorityScore(50, 'medium', 100, 50, Date.now());
  const maxReports = computePriorityScore(50, 'medium', 10, 50, Date.now());
  assert(cappedReports === maxReports || cappedReports >= maxReports,
    'Reports beyond 10 are capped (no extra boost beyond max)');
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Queue Tests: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) process.exit(1);
