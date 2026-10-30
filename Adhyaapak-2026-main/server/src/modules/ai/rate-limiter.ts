/**
 * Client-side sliding-window limiter so we stay under the provider's per-key limit (Mesh default:
 * 100 requests a minute) instead of finding out from 429s. Time and sleeping are injected for tests.
 */
export class SlidingWindowLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Resolves when a slot is free; returns false if waiting longer than `maxWaitMs` would be needed. */
  async acquire(maxWaitMs = 5_000): Promise<boolean> {
    const t = this.now();
    while (this.stamps.length && this.stamps[0]! <= t - this.windowMs) this.stamps.shift();
    if (this.stamps.length < this.maxPerWindow) {
      this.stamps.push(t);
      return true;
    }
    const wait = this.stamps[0]! + this.windowMs - t;
    if (wait > maxWaitMs) return false;
    await this.sleep(wait);
    return this.acquire(maxWaitMs - wait);
  }
}
