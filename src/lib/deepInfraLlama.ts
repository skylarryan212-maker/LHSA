/**
 * @deprecated This module is deprecated. Use @/lib/llm-client instead.
 *
 * This file now re-exports from the new universal LLM client for backward compatibility.
 * All new code should import from @/lib/llm-client directly.
 *
 * Migration path:
 * ```typescript
 * // Old:
 * import { callDeepInfraLlama } from "@/lib/deepInfraLlama";
 *
 * // New:
 * import { callLLM } from "@/lib/llm-client";
 * ```
 */

export { callDeepInfraLlama, callLLM, type LLMCallParams, type LLMCallResult } from "./llm-client";
