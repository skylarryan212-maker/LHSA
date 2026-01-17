// Monthly API usage limits per plan tier (in USD)
export const PLAN_LIMITS = {
  free: 2.0, // $2/month
  plus: 12.0, // Harmonized limits; only price/limit differ
  max: 120.0, // Harmonized limits; only price/limit differ
} as const;

// Context window limits per plan tier (in tokens)
export const CONTEXT_WINDOW_LIMITS = {
  free: 64000, // 64K total context
  plus: 128000, // 128K total context
  max: 400000, // 400K total context
} as const;

// Max input tokens per plan tier (total context - 32K buffer for reasoning/output)
export const MAX_INPUT_TOKENS = {
  free: 32000, // 64K - 32K buffer
  plus: 96000, // 128K - 32K buffer
  max: 368000, // 400K - 32K buffer
} as const;

// Max file attachments per message
export const MAX_FILES_PER_MESSAGE = {
  free: 3,
  plus: 20,
  max: 50,
} as const;

const HUMAN_WRITING_LOOP_LIMITS = {
  free: 10,
} as const;

const HUMAN_WRITING_BUDGET_PERCENT = 0.1;

export type PlanType = keyof typeof PLAN_LIMITS;

function normalizePlanType(planType: PlanType | string): PlanType {
  const normalized = String(planType || "").toLowerCase();
  if (normalized in PLAN_LIMITS) return normalized as PlanType;
  if (normalized === "dev") return "max";
  if (normalized === "pro" || normalized === "basic") return "plus";
  return "free";
}

export function getPlanLimit(planType: PlanType | string): number {
  return PLAN_LIMITS[normalizePlanType(planType)];
}

export function calculateUsagePercentage(spending: number, planType: PlanType | string): number {
  const limit = getPlanLimit(planType);
  return (spending / limit) * 100;
}

export function getRemainingBudget(spending: number, planType: PlanType | string): number {
  const limit = getPlanLimit(planType);
  return Math.max(0, limit - spending);
}

export function hasExceededLimit(spending: number, planType: PlanType | string): boolean {
  const limit = getPlanLimit(planType);
  return spending >= limit;
}

export function getWarningThreshold(planType: PlanType | string): number {
  // Warn at 80% of limit
  return getPlanLimit(planType) * 0.8;
}

export function shouldShowWarning(spending: number, planType: PlanType | string): boolean {
  return spending >= getWarningThreshold(planType) && !hasExceededLimit(spending, planType);
}

export function getUsageStatus(spending: number, planType: PlanType | string): {
  exceeded: boolean;
  warning: boolean;
  percentage: number;
  remaining: number;
  limit: number;
} {
  const limit = getPlanLimit(planType);
  const percentage = calculateUsagePercentage(spending, planType);
  const remaining = getRemainingBudget(spending, planType);
  const exceeded = hasExceededLimit(spending, planType);
  const warning = shouldShowWarning(spending, planType);

  return {
    exceeded,
    warning,
    percentage,
    remaining,
    limit,
  };
}

export function getUsageStatusForLimit(spending: number, limit: number): {
  exceeded: boolean;
  warning: boolean;
  percentage: number;
  remaining: number;
  limit: number;
} {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const percentage = safeLimit > 0 ? (spending / safeLimit) * 100 : 0;
  const remaining = Math.max(0, safeLimit - spending);
  const exceeded = safeLimit > 0 ? spending >= safeLimit : false;
  const warning = safeLimit > 0 ? spending >= safeLimit * 0.8 && !exceeded : false;

  return {
    exceeded,
    warning,
    percentage,
    remaining,
    limit: safeLimit,
  };
}

export function getContextWindowLimit(planType: PlanType | string): number {
  return CONTEXT_WINDOW_LIMITS[normalizePlanType(planType)];
}

export function getMaxInputTokens(planType: PlanType | string): number {
  return MAX_INPUT_TOKENS[normalizePlanType(planType)];
}

export function getMaxFilesPerMessage(planType: PlanType | string): number {
  return MAX_FILES_PER_MESSAGE[normalizePlanType(planType)];
}

export function hasExceededContextWindow(inputTokens: number, planType: PlanType | string): boolean {
  const maxInput = getMaxInputTokens(planType);
  return inputTokens > maxInput;
}

export function getHumanWritingLoopLimit(planType: PlanType | string): number | null {
  const normalized = normalizePlanType(planType);
  if (normalized === "free") {
    return HUMAN_WRITING_LOOP_LIMITS.free;
  }
  return null;
}

export function getHumanWritingBudgetLimit(planType: PlanType | string): number | null {
  const normalized = normalizePlanType(planType);
  if (normalized === "free") {
    return null;
  }
  return getPlanLimit(normalized) * HUMAN_WRITING_BUDGET_PERCENT;
}

export function getHumanWritingDisplayLimit(planType: PlanType | string): number {
  return getPlanLimit(planType) * HUMAN_WRITING_BUDGET_PERCENT;
}
