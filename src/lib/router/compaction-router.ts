type ChatCompletionMessageParam = {
  role?: "system" | "user" | "assistant" | "tool" | string;
  content?: any;
  name?: string;
  [key: string]: any;
};
import { callLLM } from "../llm-client";
import { calculateCost } from "../pricing";
import { logUsageRecord } from "../usage";
import { estimateTokens } from "../tokens/estimateTokens";

export interface CompactionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CompactionInput {
  conversationMessages: CompactionMessage[];
  existingSummaryLayers: string[];
  topicLabel: string;
  topicDescription: string | null;
}

export interface CompactionOutput {
  newSummaryLayer: string;
  tokenRange: { start: number; end: number };
}

const COMPACTION_MODEL = "openai/gpt-oss-20b";

export async function runCompactionRouter(
  input: CompactionInput,
  options?: { userId?: string; conversationId?: string }
): Promise<CompactionOutput> {
  const { conversationMessages, existingSummaryLayers, topicLabel, topicDescription } = input;

  const previousLayerText = Array.isArray(existingSummaryLayers) && existingSummaryLayers.length
    ? existingSummaryLayers.join("\n\n")
    : "None";

  const formattedMessages = (conversationMessages || [])
    .map((m, idx) => {
      const role = m?.role || "user";
      const content = (m?.content || "").toString().trim();
      return `${idx + 1}. ${role}: ${content}`;
    })
    .join("\n");

  const systemPrompt = [
    "Summarize the conversation below into a concise summary layer.",
    "You have context of previous summaries from earlier in this conversation.",
    "Your job is to summarize ONLY the new turns provided below, understanding them in context of what came before.",
    "Be comprehensive but concise.",
  ].join(" ");

  const userPrompt = [
    `Topic: ${topicLabel || "Untitled topic"}`,
    topicDescription ? `Description: ${topicDescription}` : null,
    "",
    "Previous conversation context (already summarized):",
    previousLayerText,
    "",
    "New turns to summarize (provide a single summary layer covering these):",
    formattedMessages || "No new turns provided.",
    "",
    "Instructions:",
    "- Capture key discussion points, decisions, and outcomes.",
    "- Note user preferences, requirements, or constraints mentioned.",
    "- Highlight important context for future turns.",
    "- Be concise but preserve critical details.",
    "- Output format: plain text summary (no JSON or markdown).",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const { text, usage, provider } = await callLLM({
    messages,
    model: COMPACTION_MODEL,
    temperature: 0.2,
    enforceJson: false,
  });

  if (options?.userId && usage) {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    
    // Map provider to the correct model name for pricing
    let modelForPricing = COMPACTION_MODEL; // default (chutes)
    if (provider === "hyperbolic") {
      modelForPricing = "openai/gpt-oss-20b-hyperbolic";
    } else if (provider === "deepinfra") {
      modelForPricing = "gpt-oss-20b";
    }
    
    const estimatedCost = calculateCost(modelForPricing, inputTokens, 0, outputTokens);
    await logUsageRecord({
      userId: options.userId,
      conversationId: options.conversationId ?? null,
      model: modelForPricing,
      inputTokens,
      cachedTokens: 0,
      outputTokens,
      estimatedCost,
      eventType: "router",
      metadata: { stage: "compaction_router", provider },
    });
    console.log(
      `[compaction-router] Usage logged (${provider || 'unknown'}): input=${inputTokens}, output=${outputTokens}, cost=$${estimatedCost.toFixed(6)}`
    );
  }

  const newSummaryLayer = (text || "").trim();
  const totalTokens = Math.max(
    0,
    (conversationMessages || []).reduce(
      (sum, msg) => sum + Math.max(0, estimateTokens((msg?.content || "").toString())),
      0
    )
  );

  return {
    newSummaryLayer,
    tokenRange: { start: 0, end: totalTokens },
  };
}
