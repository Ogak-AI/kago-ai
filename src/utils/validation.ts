// ============================================================
// Kago AI – Input Validation & Sanitization
// Prevents XSS, injection, and ensures data integrity.
// ============================================================

/**
 * Sanitize user-generated content for safe storage and display.
 * Strips HTML tags, script injection attempts, and control characters.
 */
export function sanitizeInput(input: string): string {
  if (!input || typeof input !== 'string') return '';
  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script-like patterns
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    // Remove null bytes and control characters (keep newlines and tabs)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .trim();
}

/**
 * Sanitize text for embedding in HTML (prevents XSS).
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char] ?? char);
}

/**
 * Validate that a value is within a numeric range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate a confidence score (0–100 integer).
 */
export function validateConfidence(score: unknown): number {
  const num = typeof score === 'number' ? score : parseInt(String(score), 10);
  if (isNaN(num)) return 0;
  return clamp(Math.round(num), 0, 100);
}

/**
 * Validate that a string is a valid Reddit fullname.
 */
export function isValidRedditId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^t[1-6]_[a-z0-9]+$/i.test(id);
}

/**
 * Validate a subreddit rule for completeness and safety.
 */
export function validateRule(rule: {
  id?: string;
  name?: string;
  keywords?: string[];
  action?: string;
  reason?: string;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!rule.id || rule.id.length < 1) errors.push('Rule ID is required');
  if (!rule.name || rule.name.length < 2) errors.push('Rule name must be at least 2 characters');
  if (!rule.keywords || rule.keywords.length === 0) errors.push('At least one keyword is required');
  if (!rule.action || !['remove', 'review', 'ban'].includes(rule.action)) {
    errors.push('Action must be remove, review, or ban');
  }
  if (!rule.reason || rule.reason.length < 5) errors.push('Reason must be at least 5 characters');

  // Validate keywords don't contain dangerous patterns
  if (rule.keywords) {
    for (const kw of rule.keywords) {
      if (kw.length > 100) errors.push(`Keyword "${kw.slice(0, 20)}…" is too long (max 100 chars)`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a regex pattern is safe to use (prevents ReDoS).
 */
export function isRegexSafe(pattern: string): boolean {
  try {
    // Test that it compiles
    new RegExp(pattern, 'i');
    // Basic ReDoS protection: reject patterns with nested quantifiers
    if (/(\+|\*|\{)\s*(\+|\*|\{)/.test(pattern)) return false;
    if (/((.+)+)/.test(pattern)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Truncate a string to a maximum length with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text || '';
  return text.slice(0, maxLength - 1) + '…';
}
