import { getModelAndReasoningConfig } from "../modelConfig";
import type { ReasoningEffort, ModelFamily } from "../modelConfig";
import { callDeepInfraLlama } from "../deepInfraLlama";
import { supabaseServerAdmin } from "../supabase/server";
import { calculateCost } from "../pricing";
import { logUsageRecord } from "../usage";

export type DecisionRouterInput = {
  userMessage: string;
  recentMessages: Array<{ role?: string | null; content?: string | null; topic_id?: string | null }>;
  activeTopicId: string | null;
  currentConversationId: string;
  modelPreference: ModelFamily;
  memories?: Array<{
    id: string;
    type: string;
    title: string;
    content: string;
  }>;
  topics: Array<{
    id: string;
    conversation_id: string;
    label: string;
    summary: string | null;
    description: string | null;
    parent_topic_id: string | null;
    conversation_title?: string | null;
    project_id?: string | null;
    is_cross_conversation?: boolean;
  }>;
  artifacts: Array<{
    id: string;
    conversation_id: string;
    topic_id: string | null;
    type: string;
    title: string;
    summary: string | null;
    keywords: string[];
    snippet: string;
  }>;
};

export type DecisionRouterOutput = {
  topicAction: "continue_active" | "new" | "reopen_existing";
  primaryTopicId: string | null;
  secondaryTopicIds: string[];
  newParentTopicId: string | null;
  model:
    | "grok-4-1-fast"
    | "gpt-5-nano"
    | "gpt-oss-20b"
    | "gpt-5-mini"
    | "gpt-5.2"
    | "gpt-5.2-pro";
  effort: ReasoningEffort;
  memoryTypesToLoad: string[];
  reason: string;
};

export async function runDecisionRouter(params: {
  input: DecisionRouterInput;
  allowLLM?: boolean;
  userId?: string | null;
  conversationId?: string | null;
}): Promise<DecisionRouterOutput> {
  const { input, allowLLM = true } = params;
  const recentMessages = Array.isArray(input.recentMessages)
    ? input.recentMessages.slice(-6)
    : [];
  const speedMode = "auto" as const;
  const totalStart = Date.now();
  let llmMs: number | null = null;

  // Build prompt context
  const memorySection =
    input.memories && input.memories.length
      ? input.memories
          .slice(0, 30)
          .map((m) => `- [${m.type}] ${m.title}: ${(m.content || "").replace(/\s+/g, " ").slice(0, 120)}`)
          .join("\n")
      : "No memories.";
  const memoryTypesFromMemories = Array.from(
    new Set(
      (input.memories || [])
        .map((m) => (m?.type || "").toString().trim())
        .filter((t) => !!t)
    )
  );
  const topicIds = new Set((input.topics || []).map((t) => t.id));
  const topicsById = new Map((input.topics || []).map((t) => [t.id, t]));
  const systemPrompt = `
CRITICAL DEFAULT RULE: When there is an active topic, you MUST default to "continue_active" unless the user message is CLEARLY and EXPLICITLY starting a completely new, unrelated conversation topic. Short acknowledgments, extensions, follow-ups, and responses that don't introduce new subject matter MUST continue the active topic.

- Step 1: If there is an active topic, check if the userMessage is a continuation, acknowledgment, or extension of the recent conversation. These ALWAYS continue the active topic:
  * Short acknowledgments: "thanks", "okay", "got it", "that's good", "that's good to hear", "sounds good", "perfect", "alright", "nice", "cool", "great", "awesome", "I see", "understood", "makes sense", "good to know", "appreciate it", etc.
  * Extensions and follow-ups: "and", "also", "what about", "how about", "can you", "could you", "please", "tell me more", "explain", "elaborate", "continue", "go on", etc.
  * References to recent content: "that", "this", "it", "the above", "the previous", pronouns referring to recent messages, etc.
  * Questions about the same subject: any question that relates to the topic just discussed.
  * If the userMessage references the latest assistant turn or builds on the last exchange in ANY way, return continue_active.
  * When in doubt with an active topic, choose continue_active. — with language like "continue," "that," "following up," shared entities/intent, or otherwise builds on the last exchange — treat it as a continuation and return continue_active (unless another topic’s match is clearly stronger). 
- Step 2: Only if Step 1 finds NO continuation signal AND there is no active topic (or the message is clearly unrelated), then inspect the userMessage to see if it matches an existing topic. Reopen the best match and adjust newParentTopicId when the new message is narrower than that topic, otherwise emit new when no prior topic fits.
  * Standalone prompts often introduce new goals or subjects; only reopen when label/summary/description or artifacts strongly align, and only create "new" if no prior topic captures the intent.
  * Do not emit "new" when a relevant topic already exists — reopen_existing or continue_active should win.

When consuming the input:
- If there is an active topic, the default is continue_active. Only choose "new" if the user message is unambiguously starting a completely different subject that has no relation to the active topic.
- Compare the active topic metadata to the userMessage for shared entities/context; strong matches favor continue_active.
- Use topic summaries/labels/descriptions plus artifacts to judge intent alignment for reopen_existing vs new.
- Check artifacts carefully to see if the user is resuming work that lives elsewhere and link that artifact’s topic when reopening.
- Use the current userMessage as the final tie-breaker: if none of the above contexts fit AND there is no active topic, emit topicAction "new" and start a fresh thread.

Output shape:
{
  "labels": {
    "topicAction": "continue_active" | "new" | "reopen_existing",
    "primaryTopicId": string | null,
    "secondaryTopicIds": string[],         // array, never null
    "newParentTopicId": string | null,
    "model": "grok-4-1-fast" | "gpt-5-nano" | "gpt-oss-20b" | "gpt-5-mini" | "gpt-5.2" | "gpt-5.2-pro",
    "effort": "none" | "low" | "medium" | "high" | "xhigh",
        "memoryTypesToLoad": string[],
        "reason": { "type": "string" }
  }
}
Rules:
- Never invent placeholder strings like "none"/"null" for IDs.
- If topicAction="new": primaryTopicId MUST be null.
  * continue_active: when the user is clearly continuing the active topic (follow-up, same intent, direct references like "that", "this", "continue", or replies to the last turn) and there is no stronger match elsewhere. Consider recent messages, topic labels, and mention of shared entity/context.
  * reopen_existing: when the user intent best matches a past topic in the provided topics/artifacts (same subject/entity/task), but the active topic is different or stale. Pick the best-matching previous topic as primaryTopicId.
  * new: when the request starts a new subject/task not covered by the active topic or any prior topic (no strong match).
  * Hard rule: if the intent clearly matches an existing topic, do NOT choose "new"; continue_active or reopen_existing must win.
- Topics may include cross-chat items marked is_cross_conversation=true and conversation_title set.
  * Prefer current-chat topics unless the user clearly refers to another chat or asks about prior messages outside this conversation.
  * If you select a cross-chat topic, use topicAction="reopen_existing" with that topic id.
- secondaryTopicIds: subset of provided topic ids, exclude primary; may be empty.
  * Only include topics from past conversations if they are strictly necessary to provide a complete answer. 
  * Avoid adding them for generic pleasantries, greetings, or basic follows-ups. 
  * Keep context budget in mind; aim for 0-2 secondary topics unless a complex cross-chat reference is required.
- newParentTopicId: null or a provided topic id.
- Model selection (trade-offs, not a default):
  * grok-4-1-fast: best for long, flowing dialog and nuanced human tone; maintains conversational coherence over extended chats.
  * gpt-5-mini: best for precision tasks (clean code, structured answers, constrained requirements, academic/technical correctness).
  * gpt-oss-20b: **DEFAULT CHOICE** - more intelligent than nano, cheaper than mini; use for most general tasks including reasoning, analysis, data extraction, summarization, and moderate complexity work. Supports none, low, medium, high reasoning efforts.
  * gpt-5-nano: only for extremely simple, single-step tasks where gpt-oss-20b would be overkill (very short greetings, basic confirmations).
  * gpt-5.2: highest accuracy + best long-context reasoning; use for complex, multi-step work, larger code changes, or when mistakes are costly.
  * gpt-5.2-pro: only if explicitly requested and the task is both complex and high-stakes.
  * Reasoning vs structure:
    - Use grok-4-1-fast for deep multi-step reasoning, long-context analysis, or tool-heavy agent workflows.
    - Use gpt-5-mini for code-heavy tasks and strict instruction/format adherence.
    - Use gpt-oss-20b for general reasoning, data processing, and most standard requests.
  * Choose by task risk and intent:
    - If user experience/voice is the priority -> grok-4-1-fast
    - If correctness/structure is the priority -> gpt-5-mini
    - If the request is trivial/extremely simple -> gpt-5-nano
    - **For most normal requests (default)** -> gpt-oss-20b
    - If high complexity or high-stakes -> gpt-5.2
    * If uncertain between two, prefer the safer (more capable) option unless latency/cost is explicitly prioritized.
  * Safety override:
    - If the new user message (or the recent conversation context) appears to violate policies, trigger restrictions, or otherwise asks for disallowed/inappropriate content, pick 'grok-4-1-fast' so downstream safety/context handling stays in a single place; the reasoning effort should still follow the normal rules above.
  * Hard rules:
    - If modelPreference is set, obey it (if modelPreference is "grok-4-1-fast", you must choose grok-4-1-fast).
    - Never pick 5.2-pro unless the user asked for it.
- Effort selection:
  * Effort is for the downstream chat model's response (not for routing).
  * Default to low; use medium only when strong complexity indicators are present.
  * Guidance:
    - low: most normal requests (2-5 simple steps), short coding, simple comparisons, light planning.
    - medium: debugging, non-trivial code, math/proofs, multi-constraint planning, long-form outputs, high-stakes domains.
  * If unsure between low vs medium, choose low.
  * High or xhigh only when the request is clearly rare, intricate, or high-stakes, and you are confident it needs extra depth.
  * For gpt-5-nano: never emit "none"/"high"/"xhigh"; stay at low/medium.
  * For gpt-oss-20b: supports none, low, medium, high (no xhigh); prefer low for most tasks, medium for analytical work.
  * Model preference: if modelPreference is not "auto", you MUST return that exact model.
- Arrays must be arrays (never null). No extra fields. No markdown.
- Always populate the "reason" field with a concise (≤12 words) rationale for why you chose this routing result (topicAction/model/effort).
`;

  const inputPayload = {
    input: {
      userMessage: input.userMessage,
      recentMessages,
      activeTopicId: input.activeTopicId,
      current_conversation_id: input.currentConversationId,
      modelPreference: input.modelPreference,
      memories: input.memories ?? [],
      topics: input.topics,
      artifacts: input.artifacts,
    },
  };

  console.log("[decision-router] Input payload:", JSON.stringify(inputPayload.input, null, 2));

  const userPrompt = `Input JSON:
${JSON.stringify(inputPayload, null, 2)}

Memory summary:
${memorySection}

Return only the "labels" object matching the output schema.`;

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      labels: {
        type: "object",
        additionalProperties: false,
        properties: {
          topicAction: { type: "string", enum: ["continue_active", "new", "reopen_existing"] },
          primaryTopicId: { type: ["string", "null"] },
          secondaryTopicIds: { type: "array", items: { type: "string" }, default: [] },
          newParentTopicId: { type: ["string", "null"] },
          model: { type: "string", enum: ["grok-4-1-fast", "gpt-5-nano", "gpt-oss-20b", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"] },
          effort: { type: "string", enum: ["none", "low", "medium", "high", "xhigh"] },
          memoryTypesToLoad: { type: "array", items: { type: "string" }, default: [] },
          reason: { type: "string" },
        },
        required: [
          "topicAction",
          "primaryTopicId",
          "secondaryTopicIds",
          "newParentTopicId",
          "model",
          "effort",
          "reason",
          "memoryTypesToLoad",
        ],
      },
    },
    required: ["labels"],
  };

  const fallback = (): DecisionRouterOutput => {
    const fallbackTopicAction: DecisionRouterOutput["topicAction"] = input.activeTopicId
      ? "continue_active"
      : "new";
    const fallbackPrimary = fallbackTopicAction === "continue_active" ? input.activeTopicId : null;
    const modelConfig = getModelAndReasoningConfig(input.modelPreference, speedMode, input.userMessage);
    const memoryTypesToLoad: string[] = Array.isArray(modelConfig.availableMemoryTypes)
      ? modelConfig.availableMemoryTypes
      : memoryTypesFromMemories;
    return {
      topicAction: fallbackTopicAction,
      primaryTopicId: fallbackPrimary,
      secondaryTopicIds: [] as string[],
      newParentTopicId: null,
      model: modelConfig.resolvedFamily,
      effort: (modelConfig.reasoning?.effort as ReasoningEffort) ?? "low",
      memoryTypesToLoad,
      reason: fallbackTopicAction === "continue_active" ? "Continuing active topic" : "Starting new topic",
    };
  };

  if (!allowLLM) {
    console.log("[decision-router] Skipping LLM router (disabled); using fallback.");
    console.log("[decision-router] timing", {
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
    const output = fallback();
      void logDecisionRouterSample({
        promptVersion: "v_current",
        fallbackUsed: true,
        llmMs,
        input: inputPayload.input,
        output,
      });
    return output;
  }

  try {
    let usedFallback = false;
      const runRouterAttempt = async () => {
        const llmStart = Date.now();
        const { text, usage } = await callDeepInfraLlama({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        schemaName: "decision_router",
        schema,
        temperature: 0.2,
        model: "openai/gpt-oss-20b",
        baseURL: "https://api.deepinfra.com/v1/openai",
        enforceJson: true,
        extraParams: { reasoning_effort: "low" },
      });
      llmMs = Date.now() - llmStart;
      if (params.userId && usage) {
        const inputTokens = usage.input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        const provider = (usage as any).provider;
        
        // Map provider to the correct model name for pricing
        let modelForPricing = "openai/gpt-oss-20b"; // default (chutes)
        if (provider === "hyperbolic") {
          modelForPricing = "openai/gpt-oss-20b-hyperbolic";
        } else if (provider === "deepinfra") {
          modelForPricing = "gpt-oss-20b";
        }
        
        const estimatedCost = calculateCost(modelForPricing, inputTokens, 0, outputTokens);
        await logUsageRecord({
          userId: params.userId,
          conversationId: params.conversationId ?? input.currentConversationId,
          model: modelForPricing,
          inputTokens,
          cachedTokens: 0,
          outputTokens,
          estimatedCost,
          eventType: "router",
          metadata: { stage: "decision_router", llmMs, provider },
        });
      }
      return text;
    };

      const validateLabels = (labels: any) => {
        if (
          !labels ||
          typeof labels.topicAction !== "string" ||
          !["continue_active", "new", "reopen_existing"].includes(labels.topicAction) ||
          (labels.model &&
            !["grok-4-1-fast", "gpt-5-nano", "gpt-oss-20b", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"].includes(
              labels.model
            )) ||
          (labels.effort && !["none", "low", "medium", "high", "xhigh"].includes(labels.effort))
        ) {
          return false;
        }
        if (typeof labels.reason !== "string" || !labels.reason.trim()) {
          return false;
        }
        return true;
      };

      let labels: any = null;
      const fallbackDecision = fallback();
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const text = await runRouterAttempt();
        const cleaned = parseJsonLoose(text || "");
        const parsed = JSON.parse(cleaned);
        labels = normalizeRouterLabels(parsed?.labels);
        if (validateLabels(labels)) {
          break;
        }
        console.warn("[decision-router] Invalid labels from LLM, retrying...");
      } catch (err) {
        if (attempt === 0) {
          console.warn("[decision-router] Router attempt failed, retrying once...", err);
          continue;
        }
        throw err;
      }
    }

    if (!validateLabels(labels)) {
      usedFallback = true;
      void logDecisionRouterSample({
        promptVersion: "v_current",
        fallbackUsed: true,
        llmMs,
        input: inputPayload.input,
        output: fallbackDecision,
      });
      return fallbackDecision;
    }

    // Basic validation/enforcement
    let primaryTopicId = labels.primaryTopicId ?? null;
    if (labels.topicAction === "continue_active") {
      primaryTopicId = input.activeTopicId ?? null;
      if (!primaryTopicId) {
        labels.topicAction = "new";
      }
    } else if (labels.topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      primaryTopicId = null;
    } else if (labels.topicAction === "new") {
      primaryTopicId = null;
    }

    const validEfforts: ReasoningEffort[] = ["none", "low", "medium", "high", "xhigh"];
    const effort: ReasoningEffort = validEfforts.includes(labels.effort) ? labels.effort : fallbackDecision.effort;

    // Enforce model preference if provided
    const userForcedModel = input.modelPreference !== "auto";
    let model: DecisionRouterOutput["model"] = userForcedModel
      ? (input.modelPreference as DecisionRouterOutput["model"])
      : ((labels.model as DecisionRouterOutput["model"]) ?? fallbackDecision.model);

    // Clamp model: never auto-select 5.2-pro unless user explicitly preferred it.
    const userRequestedPro = input.modelPreference === "gpt-5.2-pro";
    if (!userForcedModel && model === "gpt-5.2-pro" && !userRequestedPro) {
      model = "gpt-5.2";
    }
    // Enforce new topic invariants
    let secondaryTopicIds =
      Array.isArray(labels.secondaryTopicIds)
        ? labels.secondaryTopicIds.filter((id: string) => topicIds.has(id) && id !== primaryTopicId)
        : [];
    let newParentTopicId =
      labels.newParentTopicId && topicIds.has(labels.newParentTopicId) ? labels.newParentTopicId : null;
    let topicAction: DecisionRouterOutput["topicAction"] = labels.topicAction;
    if (topicAction === "new") {
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }
    if (topicAction === "reopen_existing" && primaryTopicId && !topicIds.has(primaryTopicId)) {
      topicAction = "new";
      primaryTopicId = null;
      secondaryTopicIds = [];
      newParentTopicId = null;
    }
    // Prevent reopen_existing from targeting the active topic; that should be continue_active.
    if (topicAction === "reopen_existing" && input.activeTopicId && primaryTopicId === input.activeTopicId) {
      topicAction = "continue_active";
      primaryTopicId = input.activeTopicId;
      secondaryTopicIds = secondaryTopicIds.filter((id: string) => id !== primaryTopicId);
      newParentTopicId = null;
    }
    const output: DecisionRouterOutput = {
      topicAction,
      primaryTopicId,
      secondaryTopicIds,
      newParentTopicId,
      model,
      effort,
      memoryTypesToLoad: Array.isArray(labels.memoryTypesToLoad) ? labels.memoryTypesToLoad : [],
      reason: labels.reason,
    };
    void logDecisionRouterSample({
      promptVersion: "v_current",
      fallbackUsed: usedFallback,
      llmMs,
      input: inputPayload.input,
      output,
    });
    return output;
  } catch (err) {
    console.error("[decision-router] LLM routing failed, using fallback:", err);
      console.log("[decision-router] timing", {
        llmMs,
        totalMs: Date.now() - totalStart,
        allowLLM,
      });
    const output = fallback();
      void logDecisionRouterSample({
        promptVersion: "v_current",
        fallbackUsed: true,
        llmMs,
        input: inputPayload.input,
        output,
      });
    return output;
  }
  finally {
    // Log timing on successful path
    console.log("[decision-router] timing", {
      llmMs,
      totalMs: Date.now() - totalStart,
      allowLLM,
    });
  }
}

type DecisionRouterSample = {
  promptVersion: string;
  fallbackUsed: boolean;
  llmMs: number | null;
  input: any;
  output: DecisionRouterOutput;
};

async function logDecisionRouterSample(sample: DecisionRouterSample) {
  try {
    if (typeof process === "undefined") return;
    const supabase = await supabaseServerAdmin();
    const payload = {
      prompt_version: sample.promptVersion,
      input: sample.input,
      labels: sample.output,
      meta: {
        fallback: sample.fallbackUsed,
        llm_ms: sample.llmMs,
        reason: sample.output.reason,
        timestamp: new Date().toISOString(),
      },
    };
    await supabase.from("decision_router_samples").insert(payload);
  } catch (err) {
    console.warn("[decision-router] sample log failed", err);
  }
}

function parseJsonLoose(raw: string) {
  const cleaned = (raw || "")
    .replace(/```json|```/gi, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}$/);
  if (match) {
    return match[0];
  }
  return cleaned;
}

function normalizeRouterLabels(labels: any): DecisionRouterOutput {
  const defaultLabels: DecisionRouterOutput = {
    topicAction: "new",
    primaryTopicId: null,
    secondaryTopicIds: [] as string[],
    newParentTopicId: null,
    model: "gpt-oss-20b",
    effort: "low",
    memoryTypesToLoad: [] as string[],
    reason: "Fallback decision",
  };
  if (!labels || typeof labels !== "object") return defaultLabels;
  return {
    ...defaultLabels,
    topicAction:
      typeof labels.topicAction === "string" &&
      ["continue_active", "new", "reopen_existing"].includes(labels.topicAction)
        ? labels.topicAction
        : defaultLabels.topicAction,
    primaryTopicId:
      typeof labels.primaryTopicId === "string" ? labels.primaryTopicId : defaultLabels.primaryTopicId,
    secondaryTopicIds: Array.isArray(labels.secondaryTopicIds)
      ? labels.secondaryTopicIds.filter((id: unknown) => typeof id === "string")
      : defaultLabels.secondaryTopicIds,
    newParentTopicId:
      typeof labels.newParentTopicId === "string" ? labels.newParentTopicId : defaultLabels.newParentTopicId,
    model:
      typeof labels.model === "string" &&
      ["grok-4-1-fast", "gpt-5-nano", "gpt-oss-20b", "gpt-5-mini", "gpt-5.2", "gpt-5.2-pro"].includes(labels.model)
        ? labels.model
        : defaultLabels.model,
    effort:
      typeof labels.effort === "string" &&
      ["none", "low", "medium", "high", "xhigh"].includes(labels.effort)
        ? labels.effort
        : defaultLabels.effort,
    memoryTypesToLoad: Array.isArray(labels.memoryTypesToLoad)
      ? labels.memoryTypesToLoad.filter((type: unknown) => typeof type === "string")
      : defaultLabels.memoryTypesToLoad,
    reason: sanitizeReason(labels.reason),
  };
}

function sanitizeReason(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "No reason provided";
  }
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 80);
}
