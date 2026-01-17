import { parseHumanWritingCost } from "@/lib/human-writing/utils";

type UsageRow = {
  run_id?: string | null;
  estimated_cost?: number | string | null;
  step?: string | null;
};

const HUMAN_WRITING_STEPS = ["draft", "detect", "humanize", "review", "patch"] as const;
const LOOP_STEPS = new Set(["detect", "humanize"]);

const getPeriodStartIso = async (supabase: any, userId: string): Promise<string> => {
  const now = new Date();
  const fallbackStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  const { data: planData, error: planError } = await supabase
    .from("user_plans")
    .select("current_period_start")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  const periodStartValue =
    !planError && planData ? (planData as { current_period_start?: string | null }).current_period_start : null;
  if (periodStartValue) {
    const candidateMs = new Date(periodStartValue).getTime();
    if (!Number.isNaN(candidateMs)) {
      return new Date(candidateMs).toISOString();
    }
  }

  return fallbackStart;
};

export type HumanWritingUsageSummary = {
  periodStartIso: string;
  loopCount: number;
  costUsd: number;
  runIds: string[];
};

export async function getHumanWritingUsageSummary(params: {
  supabase: any;
  userId: string;
}): Promise<HumanWritingUsageSummary> {
  const { supabase, userId } = params;
  const periodStartIso = await getPeriodStartIso(supabase, userId);

  const { data, error } = await supabase
    .from("user_api_usage")
    .select("run_id, estimated_cost, step")
    .eq("user_id", userId)
    .gte("created_at", periodStartIso)
    .in("step", [...HUMAN_WRITING_STEPS]);

  if (error) {
    console.error("[human-writing][limits] usage lookup failed", error);
    return { periodStartIso, loopCount: 0, costUsd: 0, runIds: [] };
  }

  const runIds = new Set<string>();
  let costUsd = 0;
  (data as UsageRow[] | null | undefined)?.forEach((row) => {
    if (row?.step && LOOP_STEPS.has(row.step) && row.run_id) {
      runIds.add(row.run_id);
    }
    costUsd += parseHumanWritingCost(row?.estimated_cost ?? null) ?? 0;
  });

  return {
    periodStartIso,
    loopCount: runIds.size,
    costUsd,
    runIds: Array.from(runIds),
  };
}
