// ============================================================
// Kago AI – Reputation System Unit Tests
// Validates trust score computation, risk levels, tiers, and
// decay/recovery mechanics.
// ============================================================

import {
  computeTrustScore,
  getRiskLevel,
  getReputationTier,
  computeApprovalRatio,
} from '../utils/scoring.js';
import type { RiskLevel, ReputationTier } from '../types.js';

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
// Trust Score Tests
// ──────────────────────────────────────────────

describe('Initial trust score', () => {
  const score = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 0, karma: 0, overrideCount: 0,
  });
  assert(score === 50, `New user starts at 50 (got ${score})`);
});

describe('Violations decrease trust', () => {
  const clean = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  const violator = computeTrustScore({
    violations: 3, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  assert(violator < clean, `Violations decrease score (${violator} < ${clean})`);
});

describe('Bans heavily penalize trust', () => {
  const noBans = computeTrustScore({
    violations: 1, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  const banned = computeTrustScore({
    violations: 1, approvals: 0, bans: 1, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  assert(banned < noBans, `Bans heavily penalize (${banned} < ${noBans})`);
  assert(noBans - banned >= 20, `Ban penalty is at least 20 points (diff: ${noBans - banned})`);
});

describe('Spam incidents reduce trust', () => {
  const clean = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  const spammer = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 3,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  assert(spammer < clean, `Spam reduces trust (${spammer} < ${clean})`);
});

describe('Approvals build trust', () => {
  const noApprovals = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  const approved = computeTrustScore({
    violations: 0, approvals: 10, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  assert(approved > noApprovals, `Approvals build trust (${approved} > ${noApprovals})`);
});

describe('Karma provides bonus', () => {
  const lowKarma = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 100, overrideCount: 0,
  });

  const highKarma = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 50000, overrideCount: 0,
  });

  assert(highKarma > lowKarma, `High karma provides bonus (${highKarma} > ${lowKarma})`);
});

describe('Account age provides bonus', () => {
  const newAccount = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 1, karma: 1000, overrideCount: 0,
  });

  const oldAccount = computeTrustScore({
    violations: 0, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 365, karma: 1000, overrideCount: 0,
  });

  assert(oldAccount > newAccount, `Older account gets bonus (${oldAccount} > ${newAccount})`);
});

describe('False positive recovery', () => {
  const withoutRecovery = computeTrustScore({
    violations: 2, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 0,
  });

  const withRecovery = computeTrustScore({
    violations: 2, approvals: 0, bans: 0, spamCount: 0,
    accountAgeDays: 30, karma: 1000, overrideCount: 2,
  });

  assert(withRecovery > withoutRecovery,
    `Override recovery restores trust (${withRecovery} > ${withoutRecovery})`);
});

describe('Trust score bounds', () => {
  // Extremely negative user
  const worst = computeTrustScore({
    violations: 20, approvals: 0, bans: 5, spamCount: 10,
    accountAgeDays: 0, karma: 0, overrideCount: 0,
  });
  assert(worst >= 0, `Score never below 0 (got ${worst})`);

  // Extremely positive user
  const best = computeTrustScore({
    violations: 0, approvals: 100, bans: 0, spamCount: 0,
    accountAgeDays: 3650, karma: 1000000, overrideCount: 0,
  });
  assert(best <= 100, `Score never above 100 (got ${best})`);
});

// ──────────────────────────────────────────────
// Risk Level Tests
// ──────────────────────────────────────────────

describe('Risk level assignment', () => {
  assert(getRiskLevel(90) === 'minimal', 'Trust 90 → minimal risk');
  assert(getRiskLevel(80) === 'minimal', 'Trust 80 → minimal risk');
  assert(getRiskLevel(70) === 'low', 'Trust 70 → low risk');
  assert(getRiskLevel(60) === 'low', 'Trust 60 → low risk');
  assert(getRiskLevel(50) === 'moderate', 'Trust 50 → moderate risk');
  assert(getRiskLevel(40) === 'moderate', 'Trust 40 → moderate risk');
  assert(getRiskLevel(30) === 'high', 'Trust 30 → high risk');
  assert(getRiskLevel(25) === 'high', 'Trust 25 → high risk');
  assert(getRiskLevel(20) === 'critical', 'Trust 20 → critical risk');
  assert(getRiskLevel(0) === 'critical', 'Trust 0 → critical risk');
});

// ──────────────────────────────────────────────
// Reputation Tier Tests
// ──────────────────────────────────────────────

describe('Reputation tier assignment', () => {
  assert(getReputationTier(90) === 'trusted', 'Trust 90 → trusted');
  assert(getReputationTier(80) === 'trusted', 'Trust 80 → trusted');
  assert(getReputationTier(70) === 'established', 'Trust 70 → established');
  assert(getReputationTier(60) === 'established', 'Trust 60 → established');
  assert(getReputationTier(50) === 'neutral', 'Trust 50 → neutral');
  assert(getReputationTier(40) === 'neutral', 'Trust 40 → neutral');
  assert(getReputationTier(30) === 'suspicious', 'Trust 30 → suspicious');
  assert(getReputationTier(25) === 'suspicious', 'Trust 25 → suspicious');
  assert(getReputationTier(20) === 'untrusted', 'Trust 20 → untrusted');
  assert(getReputationTier(0) === 'untrusted', 'Trust 0 → untrusted');
});

// ──────────────────────────────────────────────
// Approval Ratio Tests
// ──────────────────────────────────────────────

describe('Approval ratio computation', () => {
  assert(computeApprovalRatio(10, 0) === 1, 'All approvals → ratio 1.0');
  assert(computeApprovalRatio(0, 10) === 0, 'All violations → ratio 0.0');
  assert(computeApprovalRatio(0, 0) === 1, 'No history → ratio 1.0 (benefit of doubt)');

  const ratio = computeApprovalRatio(7, 3);
  assert(ratio === 0.7, `7 approvals, 3 violations → ratio 0.7 (got ${ratio})`);

  const halfRatio = computeApprovalRatio(5, 5);
  assert(halfRatio === 0.5, `Equal split → ratio 0.5 (got ${halfRatio})`);
});

// ──────────────────────────────────────────────
// Scenario Tests
// ──────────────────────────────────────────────

describe('Real-world scenarios', () => {
  // Scenario: Established community member
  const veteran = computeTrustScore({
    violations: 1, approvals: 50, bans: 0, spamCount: 0,
    accountAgeDays: 730, karma: 25000, overrideCount: 1,
  });
  assert(veteran >= 70, `Community veteran has high trust (${veteran})`);
  assert(getReputationTier(veteran) === 'established' || getReputationTier(veteran) === 'trusted',
    `Veteran is established or trusted (${getReputationTier(veteran)})`);

  // Scenario: Known spammer
  const spammer = computeTrustScore({
    violations: 8, approvals: 0, bans: 2, spamCount: 5,
    accountAgeDays: 7, karma: 1, overrideCount: 0,
  });
  assert(spammer < 25, `Known spammer has very low trust (${spammer})`);
  assert(getRiskLevel(spammer) === 'critical', `Spammer is critical risk`);

  // Scenario: New user who had one false positive
  const newUser = computeTrustScore({
    violations: 1, approvals: 2, bans: 0, spamCount: 0,
    accountAgeDays: 14, karma: 500, overrideCount: 1,
  });
  assert(newUser >= 40 && newUser <= 65,
    `New user with FP recovery is moderate trust (${newUser})`);
});

// ── Summary ─────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}`);
console.log(`Reputation Tests: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) process.exit(1);
