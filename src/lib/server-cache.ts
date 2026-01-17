
type CacheEntry<T> = {
  value: T;
  expires: number;
};

const cache = new Map<string, CacheEntry<any>>();

/**
 * A extremely simple in-memory TTL cache for server-side hot reads.
 * Note: In a true serverless environment, this only persists as long as the lambda instance is warm.
 */
export async function withCache<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key);

  if (entry && entry.expires > now) {
    return entry.value;
  }

  const result = await fn();
  cache.set(key, { value: result, expires: now + ttlMs });
  
  // Basic cleanup: if cache grows too large, clear it entirely
  if (cache.size > 1000) {
    cache.clear();
  }

  return result;
}

export function invalidateCache(key: string) {
  cache.delete(key);
}
