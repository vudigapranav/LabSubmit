// Failed-attempt limiter for credential endpoints (SECURITY_AUDIT.md S7).
//
// In-memory and per server instance: on Vercel each instance keeps its own counts, so this
// raises the cost of guessing rather than guaranteeing a global limit. A shared store
// (Postgres/Redis) would make it global; not worth a new service for a college deployment.
//
// Only FAILURES are counted, and a success clears the account's counter, so a student who
// mistypes once is never affected. Trade-off, deliberately accepted: someone who knows a
// roll number can lock that account for one window by guessing wrong repeatedly. The window
// is short so that this cannot keep anyone out of an exam for long.

type Bucket = { failures: number; windowStart: number };

export type LimitRule = { maxFailures: number; windowMs: number };

export class FailureLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private rule: LimitRule) {}

  private live(key: string, now: number): Bucket | undefined {
    const b = this.buckets.get(key);
    if (b && now - b.windowStart >= this.rule.windowMs) {
      this.buckets.delete(key);
      return undefined;
    }
    return b;
  }

  /** Seconds until the key may try again, or 0 if it is not blocked. */
  retryAfterSeconds(key: string, now = Date.now()): number {
    const b = this.live(key, now);
    if (!b || b.failures < this.rule.maxFailures) return 0;
    return Math.max(1, Math.ceil((b.windowStart + this.rule.windowMs - now) / 1000));
  }

  recordFailure(key: string, now = Date.now()): void {
    const b = this.live(key, now);
    if (b) b.failures += 1;
    else this.buckets.set(key, { failures: 1, windowStart: now });
    // Bound memory under a flood of distinct keys.
    if (this.buckets.size > 50_000) this.prune(now);
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private prune(now: number): void {
    this.buckets.forEach((b, k) => {
      if (now - b.windowStart >= this.rule.windowMs) this.buckets.delete(k);
    });
  }
}

// Per account: 10 failures per 15 minutes.
export const loginAccountLimiter = new FailureLimiter({ maxFailures: 10, windowMs: 15 * 60_000 });
// Per client address: set high because an entire college lab can sit behind one NAT
// address, and a lab full of typos must not lock everyone out. Catches spraying across
// many accounts from one machine.
export const loginAddressLimiter = new FailureLimiter({ maxFailures: 100, windowMs: 15 * 60_000 });

// First hop of X-Forwarded-For. On Vercel the platform sets this header, so it is the real
// client. Elsewhere it can be spoofed — which is why the per-account limit, keyed on what
// the attacker is trying to break into, is the primary control and this is secondary.
export function clientAddress(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
