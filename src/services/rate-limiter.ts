/**
 * Rate Limiter Service
 *
 * Provides in-memory rate limiting for Slack message processing.
 * Note: Per-instance in serverless environments.
 */

/** Rate limit: messages per minute per user (Rule 2: Fixed bounds) */
const RATE_LIMIT_MAX = 10;

/** Rate limit window in milliseconds */
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/** Maximum rate limit map entries to prevent memory growth (Rule 2) */
const MAX_RATE_LIMIT_ENTRIES = 1000;

/** In-memory rate limit state (per-instance in serverless) */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();

/** Clean up expired rate limit entries (Rule 2: Fixed bounds on memory) */
function cleanupRateLimitMap(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

/** Check and update rate limit for a user (Rule 5: returns false if limit exceeded) */
export function checkRateLimit(userId: string): boolean {
  // Rule 5: Validate input
  if (!userId || typeof userId !== "string") {
    return false;
  }

  const now = Date.now();

  // Rule 2: Bound the map size to prevent memory exhaustion
  if (rateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES) {
    cleanupRateLimitMap();
  }

  const entry = rateLimitMap.get(userId);

  // New user or window expired: reset counter
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  // Check if limit exceeded
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }

  // Increment counter
  entry.count++;
  return true;
}
