import { invalidateCache } from "@/lib/server-cache";

const HUMAN_WRITING_CACHE_KEYS = (userId: string) => [`humanWritingSpending:${userId}`, `monthlySpending:${userId}`];
const REPHRASY_CREDIT_USD = 0.1;
const COST_KEY_CANDIDATES = [
  "usd",
  "total",
  "cost",
  "amount",
  "value",
  "estimated",
  "estimatedCost",
  "price",
  "priceUsd",
];

function parseCostValue(value: unknown, seen: WeakSet<object>): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/[^0-9.+-eE]/g, "");
    const parsed = parseFloat(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseCostValue(item, seen);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return null;
    }
    seen.add(value);
    for (const key of COST_KEY_CANDIDATES) {
      if (key in value) {
        const nested = parseCostValue((value as Record<string, unknown>)[key], seen);
        if (nested !== null) {
          return nested;
        }
      }
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const parsed = parseCostValue(nested, seen);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

export function parseHumanWritingCost(value: unknown): number | null {
  return parseCostValue(value, new WeakSet<object>());
}

export function convertRephrasyCreditsToUsd(credits: number | null): number | null {
  if (typeof credits !== "number" || !Number.isFinite(credits)) return null;
  return credits * REPHRASY_CREDIT_USD;
}

export function estimateRephrasyCredits(wordCount: number): number | null {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return null;
  return 0.1 + (wordCount / 100) * 0.1;
}

export function resolveRephrasyCost(params: {
  rawCost: unknown;
  wordCount?: number | null;
}): { credits: number | null; costUsd: number | null } {
  const parsedCredits = parseHumanWritingCost(params.rawCost);
  const fallbackCredits =
    parsedCredits === null && typeof params.wordCount === "number"
      ? estimateRephrasyCredits(params.wordCount)
      : null;
  const credits = parsedCredits ?? fallbackCredits;
  const costUsd = convertRephrasyCreditsToUsd(credits);
  return { credits, costUsd };
}

export function invalidateHumanWritingUsageCaches(userId?: string | null) {
  if (!userId) return;
  for (const key of HUMAN_WRITING_CACHE_KEYS(userId)) {
    invalidateCache(key);
  }
}
