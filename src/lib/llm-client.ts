/**
 * Universal LLM client that supports multiple providers.
 *
 * Supports:
 * - OpenRouter (primary)
 * - DeepInfra (fallback)
 *
 * Configure via environment variables:
 * - LLM_PROVIDER: "openrouter" | "deepinfra" (default: "openrouter")
 * - OPENROUTER_API_KEY: API key for OpenRouter
 * - DEEPINFRA_API_KEY: API key for DeepInfra (fallback)
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenRouter } from "@openrouter/sdk";
import { buildOpenRouterAttribution } from "@/lib/openrouter/headers";

// ============================================================================
// Types
// ============================================================================

export interface LLMCallParams {
  messages: ChatCompletionMessageParam[];
  schemaName?: string;
  schema?: any;
  model?: string;
  temperature?: number;
  enforceJson?: boolean;
  extraParams?: Record<string, any>;
  baseURL?: string;
  provider?: "openrouter" | "deepinfra";
}

export interface LLMCallResult {
  text: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  provider?: string;
}

export interface LLMStreamChunk {
  token?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || "openrouter") as "openrouter" | "deepinfra";
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const OPENROUTER_PROVIDER_PRIMARY = "chutes"; // Preferred provider
const OPENROUTER_PROVIDER_FALLBACK_1 = "hyperbolic"; // First fallback
const OPENROUTER_PROVIDER_FALLBACK_2 = "deepinfra"; // Second fallback (via OpenRouter)

// ============================================================================
// OpenRouter Client (cached)
// ============================================================================

let openRouterClient: OpenRouter | null = null;

function getOpenRouterClient(): OpenRouter {
  if (openRouterClient) return openRouterClient;

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const attribution = buildOpenRouterAttribution();
  openRouterClient = new OpenRouter(
    attribution
      ? { apiKey, httpReferer: attribution.httpReferer, xTitle: attribution.xTitle }
      : { apiKey }
  );

  return openRouterClient;
}

// ============================================================================
// OpenRouter Implementation
// ============================================================================

/**
 * Call OpenRouter with a specific provider and yield tokens.
 */
export async function* streamOpenRouterWithProvider(
  params: LLMCallParams,
  providerName: string
): AsyncGenerator<LLMStreamChunk> {
  const {
    messages,
    schemaName,
    schema,
    model = DEFAULT_MODEL,
    temperature = 1.0,
    enforceJson = true,
    extraParams = {},
  } = params;

  const client = getOpenRouterClient();

  const schemaNudge =
    schema && schemaName
      ? `You must return a JSON object matching the schema "${schemaName}": ${JSON.stringify(schema)}`
      : "";

  const finalMessages: ChatCompletionMessageParam[] = schemaNudge
    ? [{ role: "system", content: schemaNudge }, ...messages]
    : messages;

  // If params.messages was updated above (identity injected), recompute finalMessages
  // to ensure identity message stays at the front and schema nudges follow.
  const updatedMessages = params.messages as ChatCompletionMessageParam[];
  const finalMessagesWithIdentity: ChatCompletionMessageParam[] = schemaNudge
    ? [{ role: "system", content: schemaNudge }, ...(updatedMessages || [])]
    : updatedMessages || [];

  const requestPayload: any = {
    model,
    messages: finalMessages,
    temperature,
    stream: true,
    provider: {
      only: [providerName],
      allowFallbacks: false,
    },
    ...extraParams,
  };

  if (enforceJson) {
    requestPayload.response_format = { type: "json_object" };
  }

  try {
    const completion = await client.chat.send(requestPayload);

    if (completion && typeof completion === "object" && Symbol.asyncIterator in (completion as any)) {
      for await (const chunk of (completion as any)) {
        if (chunk.choices?.[0]?.delta?.content) {
          yield { token: chunk.choices[0].delta.content };
        }
        if (chunk.usage) {
          yield {
            usage: {
              input_tokens: chunk.usage.prompt_tokens ?? 0,
              output_tokens: chunk.usage.completion_tokens ?? 0,
            },
          };
        }
      }
    } else {
      const content = completion.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        yield { token: content.trim() };
      }
      if (completion.usage) {
        yield {
          usage: {
            input_tokens: completion.usage.promptTokens ?? 0,
            output_tokens: completion.usage.completionTokens ?? 0,
          },
        };
      }
    }
  } catch (error) {
    console.error(`[llm-client] OpenRouter (${providerName}) stream failed:`, error);
    throw error;
  }
}

/**
 * Call OpenRouter with a specific provider.
 * @param params - LLM call parameters
 * @param providerName - OpenRouter provider name (e.g., "chutes", "hyperbolic")
 */
async function callOpenRouterWithProvider(params: LLMCallParams, providerName: string): Promise<LLMCallResult> {
  const {
    messages,
    schemaName,
    schema,
    model = DEFAULT_MODEL,
    temperature = 1.0,
    enforceJson = true,
    extraParams = {},
  } = params;

  // Inject identity system prompt here so the prompt reflects the exact
  // model string being used for this provider call. When the call enforces
  // JSON output (or when a schema is present), require the identity be
  // returned inside the JSON object and disallow free-text outside the JSON
  // to avoid JSON-parse failures in callers.
  const identityMarker = "__quarry_identity_system_prompt__";
  try {
    const shouldEmbedIdentityInJson = Boolean(enforceJson || schemaName);
    let identityContent: string;
    if (shouldEmbedIdentityInJson) {
      identityContent = `You are Quarry. If asked \"Who are you?\" or \"Who are you running on?\", include the exact phrase \"I'm Quarry, running on ${model}.\" as the value of the \"identity\" field in the JSON object you return. Do NOT output any text outside the JSON object; the caller will parse the entire response as JSON.`;
    } else {
      identityContent = `You are Quarry. When asked "Who are you?" or "Who are you running on?", respond exactly: "I'm Quarry, running on ${model}. I'm here to help with user requests and follow the conversation role instructions." Otherwise behave normally.`;
    }

    const hasQuarryIdentity = Array.isArray(messages) && messages.length > 0 && (messages as any)[0]?.metadata?.__identity_marker === identityMarker;
    if (!hasQuarryIdentity) {
      const identityMsg: any = { role: "system", content: identityContent, metadata: { __identity_marker: identityMarker } };
      params.messages = [identityMsg, ...(params.messages || [])];
    }
  } catch (e) {
    console.warn("[llm-client] failed to inject Quarry identity system prompt (openrouter):", e);
  }

  const client = getOpenRouterClient();

  // Add schema to system message if provided
  const schemaNudge =
    schema && schemaName
      ? `You must return a JSON object matching the schema "${schemaName}": ${JSON.stringify(schema)}`
      : "";

  const updatedMessages = (params.messages as ChatCompletionMessageParam[]) || messages || [];

  // Ensure identity message stays first (if present) and schema nudge follows it.
  let finalMessages: ChatCompletionMessageParam[];
  if (schemaNudge) {
    const first = updatedMessages[0];
    if (first && (first as any).metadata?.__identity_marker === identityMarker) {
      finalMessages = [first, { role: "system", content: schemaNudge }, ...(updatedMessages.slice(1) || [])];
    } else {
      finalMessages = [{ role: "system", content: schemaNudge }, ...(updatedMessages || [])];
    }
  } else {
    finalMessages = updatedMessages || [];
  }

  // Build request payload
  const requestPayload: any = {
    model,
    messages: finalMessages,
    temperature,
    stream: true,
    provider: {
      only: [providerName],
      allowFallbacks: false, // no automatic fallback
    },
    ...extraParams,
  };

  // Add response_format for JSON mode
  if (enforceJson) {
    requestPayload.response_format = { type: "json_object" };
  }

  try {
    const completion = await client.chat.send(requestPayload);

    // Handle streaming responses
    let text = "";
    let usage: any = null;

    if (completion && typeof completion === "object" && Symbol.asyncIterator in (completion as any)) {
      // It's an async iterable (stream)
      for await (const chunk of (completion as any)) {
        if (chunk.choices?.[0]?.delta?.content) {
          text += chunk.choices[0].delta.content;
        }
        if (chunk.usage) {
          usage = chunk.usage;
        }
      }
    } else {
      // Non-streaming response
      const content = completion.choices?.[0]?.message?.content;
      text = typeof content === "string" ? content.trim() : "";
      usage = completion.usage || {};
    }

    return {
      text: text.trim(),
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
      },
      provider: providerName,
    };
  } catch (error) {
    console.error(`[llm-client] OpenRouter (${providerName}) call failed:`, error);
    throw error;
  }
}

/**
 * Call OpenRouter with the primary provider (Chutes).
 */
async function callOpenRouter(params: LLMCallParams): Promise<LLMCallResult> {
  return callOpenRouterWithProvider(params, OPENROUTER_PROVIDER_PRIMARY);
}

// ============================================================================
// DeepInfra Implementation (Fallback)
// ============================================================================

async function callDeepInfra(params: LLMCallParams): Promise<LLMCallResult> {
  const {
    messages,
    schemaName,
    schema,
    model = DEFAULT_MODEL,
    temperature = 1.0,
    enforceJson = true,
    extraParams = {},
    baseURL = "https://api.deepinfra.com/v1/openai",
  } = params;

  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPINFRA_API_KEY is not set");
  }

  // Add schema to system message if provided
  const schemaNudge =
    schema && schemaName
      ? `You must return a JSON object matching the schema "${schemaName}": ${JSON.stringify(schema)}`
      : "";

  const identityMarker = "__quarry_identity_system_prompt__";
  // Build an updated messages array that may include an injected identity message
  const updatedMessages = (params.messages as ChatCompletionMessageParam[]) || messages || [];

  // Ensure identity message is present and schema nudge ordering is correct.
  try {
    const disableJsonObjectEarly = typeof model === "string" && model.includes("gpt-oss-");
    const shouldEmbedIdentityInJson = Boolean(enforceJson && !disableJsonObjectEarly);
    let identityContent: string;
    if (shouldEmbedIdentityInJson) {
      identityContent = `You are Quarry. If asked \"Who are you?\" or \"Who are you running on?\", include the exact phrase \"I'm Quarry, running on ${model}.\" as the value of the \"identity\" field in the JSON object you return. Do NOT output any text outside the JSON object; the caller will parse the entire response as JSON.`;
    } else {
      identityContent = `You are Quarry. When asked "Who are you?" or "Who are you running on?", respond exactly: "I'm Quarry, running on ${model}. I'm here to help with user requests and follow the conversation role instructions." Otherwise behave normally.`;
    }

    const hasQuarryIdentity = updatedMessages.length > 0 && (updatedMessages as any)[0]?.metadata?.__identity_marker === identityMarker;
    if (!hasQuarryIdentity) {
      const identityMsg: any = { role: "system", content: identityContent, metadata: { __identity_marker: identityMarker } };
      // Prepend identity message
      params.messages = [identityMsg, ...(params.messages || [])];
    }
  } catch (e) {
    console.warn("[llm-client] failed to inject Quarry identity system prompt (deepinfra):", e);
  }

  // Recompute updatedMessages after potential injection
  const updatedMessagesAfter = (params.messages as ChatCompletionMessageParam[]) || messages || [];
  let finalMessages: ChatCompletionMessageParam[];
  if (schemaNudge) {
    const first = updatedMessagesAfter[0];
    if (first && (first as any).metadata?.__identity_marker === identityMarker) {
      finalMessages = [first, { role: "system", content: schemaNudge }, ...(updatedMessagesAfter.slice(1) || [])];
    } else {
      finalMessages = [{ role: "system", content: schemaNudge }, ...(updatedMessagesAfter || [])];
    }
  } else {
    finalMessages = updatedMessagesAfter || [];
  }

  // Check if we should disable json_object for gpt-oss models on DeepInfra
  const isDeepInfra = baseURL.startsWith("https://api.deepinfra.com/");
  const disableJsonObject = isDeepInfra && typeof model === "string" && model.includes("gpt-oss-");
  const responseFormat = enforceJson && !disableJsonObject ? { type: "json_object" } : undefined;

  // Build request payload
  const requestPayload: any = {
    model,
    messages: finalMessages,
    temperature,
    response_format: responseFormat,
    ...extraParams,
  };

  if (disableJsonObject) {
    delete requestPayload.response_format;
  }

  // Make fetch request
  const url = new URL("chat/completions", baseURL.endsWith("/") ? baseURL : `${baseURL}/`);
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
  });

  const bodyText = await response.text();
  let data: any = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
  }

  const requestId = response.headers.get("x-request-id") ?? data?._request_id;
  if (requestId) {
    console.log("[llm-client] DeepInfra request id:", requestId);
  }

  if (!response.ok) {
    console.error("[llm-client] DeepInfra call failed:", {
      status: response.status,
      statusText: response.statusText,
      body: bodyText || null,
      requestId,
    });
    throw new Error(`DeepInfra call failed (${response.status}): ${bodyText || "no body"}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  const usage: any = data?.usage || {};

  return {
    text,
    usage: {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
    },
    provider: "deepinfra",
  };
}

// ============================================================================
// Main Exported Function
// ============================================================================

/**
 * Universal LLM call function that routes to the appropriate provider.
 *
 * Fallback chain:
 * 1. OpenRouter with Chutes (primary)
 * 2. OpenRouter with Hyperbolic (fallback 1)
 * 3. DeepInfra direct API (fallback 2)
 *
 * @param params - Call parameters
 * @returns LLM response with text and usage
 */
export async function callLLM(params: LLMCallParams): Promise<LLMCallResult> {
  const provider = params.provider || DEFAULT_PROVIDER;

  try {
    if (provider === "openrouter") {
      console.log(`[llm-client] Using OpenRouter with ${OPENROUTER_PROVIDER_PRIMARY}`);
      return await callOpenRouter(params);
    } else {
      console.log("[llm-client] Using DeepInfra");
      return await callDeepInfra(params);
    }
  } catch (error) {
    // Fallback chain for OpenRouter failures
    if (provider === "openrouter") {
      // Try Hyperbolic via OpenRouter
      console.warn(`[llm-client] ${OPENROUTER_PROVIDER_PRIMARY} failed, trying ${OPENROUTER_PROVIDER_FALLBACK_1}:`, error);
      try {
        return await callOpenRouterWithProvider(params, OPENROUTER_PROVIDER_FALLBACK_1);
      } catch (hyperbolicError) {
        console.warn(`[llm-client] ${OPENROUTER_PROVIDER_FALLBACK_1} also failed:`, hyperbolicError);
        
        // Try DeepInfra direct API as final fallback
        if (process.env.DEEPINFRA_API_KEY) {
          console.warn("[llm-client] Falling back to DeepInfra direct API");
          try {
            return await callDeepInfra(params);
          } catch (deepInfraError) {
            console.error("[llm-client] All fallbacks exhausted. DeepInfra also failed:", deepInfraError);
            throw deepInfraError;
          }
        } else {
          console.error("[llm-client] All fallbacks exhausted. DEEPINFRA_API_KEY not set.");
          throw hyperbolicError;
        }
      }
    }
    throw error;
  }
}

// ============================================================================
// Backward Compatibility (re-export with old name)
// ============================================================================

/**
 * @deprecated Use callLLM instead. This export is for backward compatibility.
 */
export async function callDeepInfraLlama(params: LLMCallParams): Promise<LLMCallResult> {
  return callLLM(params);
}
