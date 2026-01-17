/**
 * Performance instrumentation and measurement utilities.
 * Dev-only in production; use DEV_PERF_MODE to toggle visibility.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export const PERF_CONFIG = {
  /** Enable dev-only performance overlay */
  DEV_PERF_MODE: typeof process !== 'undefined' && process.env.NODE_ENV !== 'production',
  
  /** Stream flush interval in ms (lower = smoother but more CPU) */
  STREAM_FLUSH_MS: 50,
  
  /** Cold update interval in ms (metadata, domains, indicators) */
  COLD_UPDATE_MS: 250,
  
  /** Flush interval for detected low-end devices */
  LOW_END_FLUSH_MS: 120,
  
  /** Maximum tokens per flush to avoid long tasks */
  MAX_TOKENS_PER_FLUSH: 1024,
  
  /** Maximum DOM nodes for indicator chips */
  MAX_INDICATOR_CHIPS: 5,
  
  /** Throttle for search progress events */
  SEARCH_PROGRESS_THROTTLE_MS: 150,
  
  /** Throttle for indicator updates */
  INDICATOR_THROTTLE_MS: 200,
};

// ─────────────────────────────────────────────────────────────────────────────
// Device Detection
// ─────────────────────────────────────────────────────────────────────────────

let _isLowEndDevice: boolean | null = null;

/**
 * Detect if running on a low-end device.
 * Uses navigator.deviceMemory, prefers-reduced-motion, and hardware concurrency.
 */
export function isLowEndDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (_isLowEndDevice !== null) return _isLowEndDevice;
  
  const deviceMemory = (navigator as any).deviceMemory ?? 4;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 4;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  
  _isLowEndDevice = deviceMemory <= 2 || hardwareConcurrency <= 2 || prefersReducedMotion;
  return _isLowEndDevice;
}

/**
 * Get the effective flush interval based on device capabilities.
 */
export function getEffectiveFlushInterval(): number {
  return isLowEndDevice() ? PERF_CONFIG.LOW_END_FLUSH_MS : PERF_CONFIG.STREAM_FLUSH_MS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Performance Marks and Measures
// ─────────────────────────────────────────────────────────────────────────────

const markStack: Record<string, number> = {};

/**
 * Mark the start of a performance measurement.
 */
export function mark(name: string): void {
  if (!PERF_CONFIG.DEV_PERF_MODE) return;
  if (typeof performance === 'undefined') return;
  
  try {
    markStack[name] = performance.now();
    performance.mark(`${name}-start`);
  } catch {
    // Silently ignore if performance API fails
  }
}

/**
 * End a performance measurement and return duration in ms.
 */
export function measure(name: string): number {
  if (!PERF_CONFIG.DEV_PERF_MODE) return 0;
  if (typeof performance === 'undefined') return 0;
  
  const startTime = markStack[name];
  if (typeof startTime !== 'number') return 0;
  
  try {
    const endTime = performance.now();
    const duration = endTime - startTime;
    performance.mark(`${name}-end`);
    performance.measure(name, `${name}-start`, `${name}-end`);
    delete markStack[name];
    return duration;
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Counters and Metrics
// ─────────────────────────────────────────────────────────────────────────────

export interface PerfMetrics {
  /** Tokens received per second */
  tokensPerSecond: number;
  /** UI commits (React renders) per second */
  uiCommitsPerSecond: number;
  /** Average tokens per flush batch */
  avgBatchSize: number;
  /** Message list rerenders per token */
  listRerendersPerToken: number;
  /** Total tokens received */
  totalTokens: number;
  /** Total UI commits */
  totalCommits: number;
  /** Total list rerenders */
  totalListRerenders: number;
  /** Session start timestamp */
  sessionStart: number;
}

class PerfCounters {
  private tokensReceived = 0;
  private uiCommits = 0;
  private listRerenders = 0;
  private batchSizes: number[] = [];
  private sessionStart = Date.now();
  private lastResetTime = Date.now();
  
  reset(): void {
    this.tokensReceived = 0;
    this.uiCommits = 0;
    this.listRerenders = 0;
    this.batchSizes = [];
    this.sessionStart = Date.now();
    this.lastResetTime = Date.now();
  }
  
  recordToken(count = 1): void {
    this.tokensReceived += count;
  }
  
  recordUICommit(): void {
    this.uiCommits += 1;
  }
  
  recordListRerender(): void {
    this.listRerenders += 1;
  }
  
  recordBatch(size: number): void {
    this.batchSizes.push(size);
    // Keep only last 100 batches for memory efficiency
    if (this.batchSizes.length > 100) {
      this.batchSizes.shift();
    }
  }
  
  getMetrics(): PerfMetrics {
    const elapsed = Math.max(1, (Date.now() - this.sessionStart) / 1000);
    const avgBatch = this.batchSizes.length > 0
      ? this.batchSizes.reduce((a, b) => a + b, 0) / this.batchSizes.length
      : 0;
    
    return {
      tokensPerSecond: Math.round(this.tokensReceived / elapsed),
      uiCommitsPerSecond: Math.round((this.uiCommits / elapsed) * 10) / 10,
      avgBatchSize: Math.round(avgBatch * 10) / 10,
      listRerendersPerToken: this.tokensReceived > 0
        ? Math.round((this.listRerenders / this.tokensReceived) * 100) / 100
        : 0,
      totalTokens: this.tokensReceived,
      totalCommits: this.uiCommits,
      totalListRerenders: this.listRerenders,
      sessionStart: this.sessionStart,
    };
  }
  
  exportJSON(): string {
    const metrics = this.getMetrics();
    return JSON.stringify(metrics, null, 2);
  }
}

export const perfCounters = new PerfCounters();

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Buffer Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NDJSON buffer parser that avoids repeated string allocations.
 * Uses indexOf scanning instead of split() for efficiency.
 */
export class NDJSONBuffer {
  private buffer = '';
  
  /**
   * Append a chunk and extract complete lines.
   * Returns array of parsed JSON objects.
   */
  append(chunk: string): any[] {
    mark('ndjson-parse');
    this.buffer += chunk;
    const results: any[] = [];
    
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      
      if (!line.trim()) continue;
      
      try {
        results.push(JSON.parse(line));
      } catch {
        // Skip invalid JSON lines
      }
    }
    
    measure('ndjson-parse');
    return results;
  }
  
  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = '';
  }
  
  /**
   * Check if buffer has pending data.
   */
  hasPending(): boolean {
    return this.buffer.length > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batched Update Scheduler
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchedUpdateScheduler<T> {
  push(item: T): void;
  flush(): T[];
  cancel(): void;
}

/**
 * Creates a batched update scheduler that coalesces updates.
 * Uses requestAnimationFrame aligned to a minimum interval.
 */
export function createBatchedScheduler<T>(
  onFlush: (items: T[]) => void,
  options?: { interval?: number; maxItems?: number }
): BatchedUpdateScheduler<T> {
  const interval = options?.interval ?? getEffectiveFlushInterval();
  const maxItems = options?.maxItems ?? PERF_CONFIG.MAX_TOKENS_PER_FLUSH;
  
  let buffer: T[] = [];
  let rafId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastFlushTime = 0;
  
  const doFlush = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    if (buffer.length === 0) return;
    
    mark('batch-flush');
    const items = buffer.slice(0, maxItems);
    buffer = buffer.slice(maxItems);
    lastFlushTime = Date.now();
    
    perfCounters.recordBatch(items.length);
    onFlush(items);
    measure('batch-flush');
    
    // If there are remaining items, schedule another flush
    if (buffer.length > 0) {
      scheduleFlush();
    }
  };
  
  const scheduleFlush = () => {
    if (rafId !== null || timeoutId !== null) return;
    
    const elapsed = Date.now() - lastFlushTime;
    const remaining = Math.max(0, interval - elapsed);
    
    if (remaining === 0) {
      // Use raf for visual smoothness
      rafId = requestAnimationFrame(doFlush);
    } else {
      // Wait for remaining interval then use raf
      timeoutId = setTimeout(() => {
        timeoutId = null;
        rafId = requestAnimationFrame(doFlush);
      }, remaining);
    }
  };
  
  return {
    push(item: T) {
      buffer.push(item);
      perfCounters.recordToken();
      scheduleFlush();
    },
    
    flush() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      const items = buffer;
      buffer = [];
      return items;
    },
    
    cancel() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      buffer = [];
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Throttle Utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a throttled function that limits execution rate.
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  wait: number
): T & { cancel: () => void } {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  
  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const elapsed = now - lastCall;
    
    if (elapsed >= wait) {
      lastCall = now;
      fn(...args);
    } else {
      lastArgs = args;
      if (timeoutId === null) {
        timeoutId = setTimeout(() => {
          timeoutId = null;
          lastCall = Date.now();
          if (lastArgs) {
            fn(...lastArgs);
            lastArgs = null;
          }
        }, wait - elapsed);
      }
    }
  }) as T & { cancel: () => void };
  
  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
  };
  
  return throttled;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stable Reference Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compare two arrays for shallow equality.
 */
export function shallowEqualArrays<T>(a: T[] | null, b: T[] | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Compare two objects for shallow equality.
 */
export function shallowEqualObjects<T extends Record<string, any>>(
  a: T | null,
  b: T | null
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Export All
// ─────────────────────────────────────────────────────────────────────────────

export default {
  PERF_CONFIG,
  isLowEndDevice,
  getEffectiveFlushInterval,
  mark,
  measure,
  perfCounters,
  NDJSONBuffer,
  createBatchedScheduler,
  throttle,
  shallowEqualArrays,
  shallowEqualObjects,
};
