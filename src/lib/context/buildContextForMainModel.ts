import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import type { RouterDecision } from "@/lib/router/types";
import { estimateTokens } from "@/lib/tokens/estimateTokens";
import { sanitizeTopicMessageContent } from "@/lib/topics/messageSanitizer";

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type TopicRow = Database["public"]["Tables"]["conversation_topics"]["Row"];
type ArtifactRow = Database["public"]["Tables"]["artifacts"]["Row"];
type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
};

type WebSearchSummaryMeta = {
  summary: string;
  sources?: Array<{ url: string; title?: string | null }>;
  queries?: string[];
  generatedAt?: string;
  createdAt?: string | null;
};

export type ContextMessage = {
  role: "user" | "assistant";
  content: string;
  type: "message";
};

type ContextMessageWithId = {
  message: ContextMessage;
  messageId: string | null;
};

export interface BuildContextParams {
  supabase: SupabaseClient<Database>;
  conversationId: string;
  routerDecision: RouterDecision;
  manualTopicIds?: string[] | null;
  maxContextTokens?: number;
  prefetchedTopics?: TopicRow[] | null;
}

export interface BuildContextResult {
  messages: ContextMessage[];
  includedMessageIds: string[];
  source: "topic" | "manual" | "fallback";
  includedTopicIds: string[];
  summaryCount: number;
  artifactCount: number;
  debug?: {
    totalTopicTokens: number;
    summaryTokens: number;
    loadedMessageCount: number;
    trimmedMessageCount: number;
    budget: number;
  };
}

const DEFAULT_MAX_TOKENS = 350_000;
const FALLBACK_TOKEN_CAP = 200_000;
const CROSS_CHAT_TOKEN_LIMIT = 200_000;
const SECONDARY_TOPIC_TAIL = 3;
const MAX_WEB_SEARCH_SUMMARIES = 3;

export async function buildContextForMainModel({
  supabase,
  conversationId,
  routerDecision,
  manualTopicIds,
  maxContextTokens = DEFAULT_MAX_TOKENS,
  prefetchedTopics,
}: BuildContextParams): Promise<BuildContextResult> {
  const normalizedManualTopicIds = Array.isArray(manualTopicIds)
    ? manualTopicIds.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
    : [];

  const primaryTopicId = normalizedManualTopicIds.length
    ? normalizedManualTopicIds[0]
    : routerDecision.primaryTopicId;
  const secondaryTopicIds = normalizedManualTopicIds.length
    ? normalizedManualTopicIds.slice(1)
    : routerDecision.secondaryTopicIds || [];

  const requestedTopicIds = [primaryTopicId, ...secondaryTopicIds].filter(Boolean) as string[];

  let topicRows: TopicRow[] = [];
  if (requestedTopicIds.length) {
    if (Array.isArray(prefetchedTopics) && prefetchedTopics.length > 0) {
      // Use prefetched topics that match our requested IDs
      topicRows = prefetchedTopics.filter(t => requestedTopicIds.includes(t.id));
    }
    
    // If we are missing some requested topics, fetch them
    const existingIds = new Set(topicRows.map(t => t.id));
    const missingIds = requestedTopicIds.filter(id => !existingIds.has(id));
    
    if (missingIds.length > 0) {
      const { data: topics, error: topicError } = await supabase
        .from("conversation_topics")
        .select("*")
        .in("id", missingIds)
        .returns<TopicRow[]>();

      if (!topicError && Array.isArray(topics)) {
        topicRows = [...topicRows, ...topics];
      }
    }
  }

  const topicMap = new Map<string, TopicRow>(topicRows.map((topic) => [topic.id, topic]));
  let primaryTopic = primaryTopicId
    ? topicMap.get(primaryTopicId)
    : null;

  if (!primaryTopic && primaryTopicId) {
    // Fallback: attempt to fetch the primary topic directly if not returned above
    const { data: fallbackTopic } = await supabase
      .from("conversation_topics")
      .select("*")
      .eq("id", primaryTopicId)
      .maybeSingle()
      .returns<TopicRow>();
    if (fallbackTopic) {
      primaryTopic = fallbackTopic as TopicRow;
      topicRows.push(primaryTopic);
      topicMap.set(primaryTopic.id, primaryTopic);
    }
  }

  if (!primaryTopic) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages.map((entry) => entry.message),
      includedMessageIds: fallbackMessages
        .map((entry) => entry.messageId)
        .filter((id): id is string => Boolean(id)),
      source: "fallback",
      includedTopicIds: [],
      summaryCount: 0,
      artifactCount: 0,
    };
  }

  const involvedConversationIds = new Set<string>([
    conversationId,
    primaryTopic.conversation_id,
    ...topicRows.map((t) => t.conversation_id),
  ]);

  const conversationMeta = await loadConversationMetadata(supabase, Array.from(involvedConversationIds));

  const blockedTopics: TopicRow[] = [];
  if (
    primaryTopic.conversation_id !== conversationId &&
    typeof primaryTopic.token_estimate === "number" &&
    primaryTopic.token_estimate > CROSS_CHAT_TOKEN_LIMIT
  ) {
    blockedTopics.push(primaryTopic);
    primaryTopic = null;
  }

  let secondaryTopics = (routerDecision.secondaryTopicIds || [])
    .map((id) => topicMap.get(id))
    .filter((topic): topic is TopicRow => Boolean(topic));

  if (secondaryTopicIds.length) {
    secondaryTopics = secondaryTopicIds
      .map((id) => topicMap.get(id))
      .filter((topic): topic is TopicRow => Boolean(topic));
  }

  secondaryTopics = secondaryTopics.filter((topic) => {
    if (topic.conversation_id === conversationId) return true;
    if (typeof topic.token_estimate !== "number") return true;
    if (topic.token_estimate <= CROSS_CHAT_TOKEN_LIMIT) return true;
    blockedTopics.push(topic);
    return false;
  });

  if (!primaryTopic) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    const blockedNotices = buildBlockedTopicNotices(blockedTopics, conversationMeta, conversationId);
    const blockedFallbackNotices: ContextMessageWithId[] = blockedNotices.map((notice) => ({
      message: notice,
      messageId: null,
    }));
    const combinedFallback = blockedFallbackNotices.length
      ? blockedFallbackNotices.concat(fallbackMessages)
      : fallbackMessages;
    const trimmedFallback = trimContextMessagesWithIds(
      combinedFallback,
      Math.min(maxContextTokens, DEFAULT_MAX_TOKENS)
    ).trimmed;
    return {
      messages: trimmedFallback.map((entry) => entry.message),
      includedMessageIds: trimmedFallback
        .map((entry) => entry.messageId)
        .filter((id): id is string => Boolean(id)),
      source: "fallback",
      includedTopicIds: [],
      summaryCount: blockedNotices.length,
      artifactCount: 0,
    };
  }

  const summaryMessages: ContextMessageWithId[] = [];
  const webSearchSummaryMessages: ContextMessageWithId[] = [];
  const conversationMessages: ContextMessageWithId[] = [];
  const includedTopics = new Set<string>([primaryTopic.id]);
  let summaryCount = 0;
  let artifactCount = 0;

  const blockedNotices = buildBlockedTopicNotices(blockedTopics, conversationMeta, conversationId);
  for (const notice of blockedNotices) {
    summaryMessages.push({ message: notice, messageId: null });
    summaryCount += 1;
  }
  const primaryOrigin = formatTopicOrigin(primaryTopic, conversationMeta, conversationId);
  const crossChatPrimaryNotice = buildCrossChatPrimaryNotice(
    primaryTopic,
    conversationMeta,
    conversationId
  );

  if (primaryTopic.summary?.trim()) {
    const summaryContent = `[Topic summary: ${primaryTopic.label} from ${primaryOrigin}] ${primaryTopic.summary.trim()}`;
    summaryMessages.push({
      message: {
        role: "assistant",
        content: summaryContent,
        type: "message",
      },
      messageId: null,
    });
    summaryCount += 1;
    console.log(`[buildContext] 📝 Added primary topic summary for "${primaryTopic.label}" (${estimateTokens(summaryContent)} tokens, ${primaryTopic.summary.length} chars)`);
  } else {
    console.log(`[buildContext] ⚠️ Primary topic "${primaryTopic.label}" has NO summary`);
  }

  const [primaryMessages, secondaryTailText, artifacts, secondaryMessagesBatches] = await Promise.all([
    loadTopicMessages(supabase, primaryTopic.conversation_id, primaryTopic.id),
    secondaryTopics.length
      ? buildSecondaryTailSnippets(
          supabase,
          secondaryTopics.map((topic) => ({ topicId: topic.id, conversationId: topic.conversation_id }))
        )
      : Promise.resolve({}),
    routerDecision.artifactsToLoad.length
      ? loadArtifactsByIds(supabase, routerDecision.artifactsToLoad, Math.floor(maxContextTokens * 0.2))
      : Promise.resolve([]),
    Promise.all(
      secondaryTopics.map((topic) => loadTopicMessages(supabase, topic.conversation_id, topic.id))
    ),
  ]);

  for (const topic of secondaryTopics) {
    includedTopics.add(topic.id);
    const summaryParts: string[] = [];
    const originLabel = formatTopicOrigin(topic, conversationMeta, conversationId);
    if (topic.summary?.trim()) {
      summaryParts.push(topic.summary.trim());
    }
    const tailText = (secondaryTailText as Record<string, string>)[topic.id];
    if (tailText) {
      summaryParts.push(`Recent notes: ${tailText}`);
    }
    if (!summaryParts.length) {
      console.log(`[buildContext] ⚠️ Secondary topic "${topic.label}" has NO summary content`);
      continue;
    }
    const summaryContent = `[Reference summary: ${topic.label} from ${originLabel}] ${summaryParts.join(" | ")}`;
    summaryMessages.push({
      message: {
        role: "assistant",
        content: summaryContent,
        type: "message",
      },
      messageId: null,
    });
    summaryCount += 1;
    console.log(`[buildContext] 📝 Added secondary topic summary for "${topic.label}" (${estimateTokens(summaryContent)} tokens)`);
  }

  for (const artifact of artifacts) {
    artifactCount += 1;
    if (artifact.topic_id) {
      includedTopics.add(artifact.topic_id);
    }
  }

  const webSearchSummaries = collectWebSearchSummaries(
    [...primaryMessages, ...secondaryMessagesBatches.flat()],
    MAX_WEB_SEARCH_SUMMARIES
  );
  for (const summary of webSearchSummaries) {
    const header = summary.generatedAt
      ? `Web search summary (${summary.generatedAt.split("T")[0]}):`
      : "Web search summary:";
    const queriesLine = summary.queries?.length
      ? `Queries: ${summary.queries.join(" | ")}`
      : "";
    const sourcesLine = summary.sources?.length
      ? `Sources:\n${summary.sources
          .map((source, index) => `[${index + 1}] ${source.title ?? source.url} - ${source.url}`)
          .join("\n")}`
      : "";
    const summaryContent = [header, summary.summary, queriesLine, sourcesLine]
      .filter((line) => line && line.trim().length > 0)
      .join("\n\n");
    webSearchSummaryMessages.push({
      message: {
        role: "assistant",
        content: summaryContent,
        type: "message",
      },
      messageId: null,
    });
    summaryCount += 1;
  }

  // If the primary topic has been compacted (summary + metadata cutoff present),
  // we should rely on the compacted summary as the canonical history.
  // After compaction, we load ONLY summaries + current prompt (no verbatim history).
  const compactionCutoff = (primaryTopic.metadata as any)?.compaction?.lastCompactionAt ?? null;
  const compactionMetadata = (primaryTopic.metadata as any)?.compaction;
  const PRIMARY_VERBATIM_TAIL = 0; // Changed from 3 to 0 - no verbatim messages after compaction
  
  // Check if compaction exists: either we have a cutoff timestamp OR we have a summary with compaction metadata
  const hasCompactionMetadata = Boolean(compactionCutoff) || Boolean(compactionMetadata);
  const primaryHasCompaction = hasCompactionMetadata && Boolean(primaryTopic.summary?.trim());

  console.log(`[buildContext] Primary topic ${primaryTopic.id} compaction check:`, {
    topicLabel: primaryTopic.label,
    hasCompactionMetadata,
    compactionCutoff,
    hasSummary: Boolean(primaryTopic.summary?.trim()),
    summaryLength: primaryTopic.summary?.length || 0,
    primaryHasCompaction,
    totalPrimaryMessages: primaryMessages.length,
    compactionMetadata: compactionMetadata || null,
  });

  let filteredPrimaryMessages: MessageRow[] = primaryMessages;
  if (primaryHasCompaction) {
    // Compaction exists with summary: only keep the last N messages for continuity (N=0 means none)
    filteredPrimaryMessages = primaryMessages.slice(
      Math.max(0, primaryMessages.length - PRIMARY_VERBATIM_TAIL)
    );
    console.log(`[buildContext] ✅ Primary topic compacted: filtered ${primaryMessages.length} messages to ${filteredPrimaryMessages.length} (verbatim tail = ${PRIMARY_VERBATIM_TAIL})`);
  } else if (compactionCutoff) {
    // Legacy behavior: keep a small pre-cutoff overlap tail plus everything after.
    const cutoff = String(compactionCutoff);
    const before: MessageRow[] = [];
    const after: MessageRow[] = [];
    for (const m of primaryMessages) {
      const created = m.created_at || "";
      if (created > cutoff) {
        after.push(m);
      } else {
        before.push(m);
      }
    }
    const tailBefore = before.slice(Math.max(0, before.length - PRIMARY_VERBATIM_TAIL));
    filteredPrimaryMessages = [...tailBefore, ...after];
  }

  // Apply the same "summary only" rule to secondary topics that have been compacted
  const SECONDARY_VERBATIM_TAIL = 0; // Changed from 3 to 0
  const filteredSecondaryMessagesBatches: MessageRow[][] = secondaryMessagesBatches.map((batch, idx) => {
    const topic = secondaryTopics[idx];
    const secondaryCompactionAt = topic ? (topic.metadata as any)?.compaction?.lastCompactionAt : null;
    const secondaryHasCompaction = Boolean(secondaryCompactionAt) && Boolean(topic?.summary?.trim());
    if (!secondaryHasCompaction) return batch;
    console.log(`[buildContext] Secondary topic ${topic.id} compacted: filtered ${batch.length} messages to 0 (summary only)`);
    return batch.slice(Math.max(0, batch.length - SECONDARY_VERBATIM_TAIL));
  });

  const allTopicMessages: MessageRow[] = [
    ...filteredPrimaryMessages,
    ...filteredSecondaryMessagesBatches.flat(),
  ].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));

  const totalTopicTokens = estimateTopicMessagesTokens(allTopicMessages);
  const summaryTokens = [...summaryMessages, ...webSearchSummaryMessages].reduce(
    (sum, msg) => sum + estimateTokens(msg.message.content),
    0
  );
  let trimmedMessageCount = 0;

  const anyCompaction =
    primaryHasCompaction ||
    secondaryTopics.some((topic) => Boolean((topic.metadata as any)?.compaction?.lastCompactionAt) && Boolean(topic.summary?.trim()));

  console.log(`[buildContext] Compaction summary:`, {
    anyCompaction,
    primaryHasCompaction,
    totalTopicTokens,
    maxContextTokens,
    summaryMessagesCount: summaryMessages.length + webSearchSummaryMessages.length,
    conversationMessagesCount: conversationMessages.length,
    filteredPrimaryCount: filteredPrimaryMessages.length,
  });

  // CRITICAL: If compaction exists, we MUST use summaries to avoid loading all messages
  // This ensures context usage drops after compaction. Even if totalTopicTokens is small
  // (because messages were already filtered to 0), we still need to use summaries to represent
  // the compacted history.
  const shouldUseSummaries = anyCompaction || totalTopicTokens > maxContextTokens;
  
  console.log(`[buildContext] shouldUseSummaries = ${shouldUseSummaries} (anyCompaction=${anyCompaction}, totalTopicTokens=${totalTopicTokens}, maxContextTokens=${maxContextTokens})`);
  
  // Safety check: if compaction exists but summaries aren't being used, force it
  // This prevents a bug where compaction happened but summaries are cleared
  if (anyCompaction && summaryMessages.length === 0) {
    console.error(`[buildContext] ❌ ERROR: Compaction detected but no summaries found! This should not happen. Primary topic summary: ${primaryTopic.summary?.substring(0, 100)}...`);
  }
  if (!shouldUseSummaries) {
    // Load all messages (no summaries needed) and cap with artifacts if necessary
    // NOTE: allTopicMessages here is already filtered if compaction exists (to 0 messages now)
    // So even in this branch, if compaction happened, we're using NO verbatim messages
    console.log(`[buildContext] Branch: NOT using summaries (loading ${allTopicMessages.length} verbatim messages)`);
    if (crossChatPrimaryNotice) {
      conversationMessages.push({ message: crossChatPrimaryNotice, messageId: null });
    }
    allTopicMessages.forEach((msg) => {
      const originLabel =
        msg.conversation_id === conversationId
          ? null
          : formatConversationOrigin(conversationMeta, msg.conversation_id, conversationId);
      conversationMessages.push({
        message: toContextMessage(msg, originLabel),
        messageId: msg.id,
      });
    });
    // Only clear summaries if there's no compaction - if compaction exists, summaries are essential
    if (!anyCompaction) {
      console.log(`[buildContext] Clearing summaries because no compaction exists`);
      summaryMessages.length = 0;
      summaryCount = webSearchSummaryMessages.length;
    } else {
      console.log(`[buildContext] Keeping ${summaryMessages.length} summaries because compaction exists`);
    }
  } else {
    // Using summaries: include summaries and trim messages to remaining budget
    console.log(
      `[buildContext] Branch: USING summaries (${
        summaryMessages.length + webSearchSummaryMessages.length
      } summaries, ${summaryTokens} tokens)`
    );
    const budgetForMessages = Math.max(0, maxContextTokens - summaryTokens);
    console.log(`[buildContext] Budget for verbatim messages: ${budgetForMessages} tokens (after reserving ${summaryTokens} for summaries)`);
    const { trimmed } = trimMessagesToBudget(allTopicMessages, budgetForMessages);
    trimmedMessageCount = allTopicMessages.length - trimmed.length;
    console.log(`[buildContext] Trimmed ${trimmedMessageCount} messages, keeping ${trimmed.length} verbatim messages`);
    if (crossChatPrimaryNotice) {
      conversationMessages.push({ message: crossChatPrimaryNotice, messageId: null });
    }
    trimmed.forEach((msg) => {
      const originLabel =
        msg.conversation_id === conversationId
          ? null
          : formatConversationOrigin(conversationMeta, msg.conversation_id, conversationId);
      conversationMessages.push({
        message: toContextMessage(msg, originLabel),
        messageId: msg.id,
      });
    });
  }

  // Place the chronological conversation messages first to keep the prefix as stable as possible
  // for prompt caching. Summaries/artifacts are appended after to avoid shifting the leading tokens.
  const combinedMessages = [
    ...conversationMessages,
    ...summaryMessages,
    ...webSearchSummaryMessages,
  ];
  
  // Log compaction status for debugging
  const verbatimTokens = conversationMessages.reduce((sum, msg) => sum + estimateTokens(msg.message.content), 0);
  const summaryOnlyTokens = [...summaryMessages, ...webSearchSummaryMessages].reduce(
    (sum, msg) => sum + estimateTokens(msg.message.content),
    0
  );
  const totalCombinedTokens = verbatimTokens + summaryOnlyTokens;
  
  console.log(`[buildContext] 📊 Final context composition:`, {
    verbatimMessages: conversationMessages.length,
    verbatimTokens,
    summaries: summaryMessages.length + webSearchSummaryMessages.length,
    summaryTokens: summaryOnlyTokens,
    totalMessages: combinedMessages.length,
    totalTokens: totalCombinedTokens,
    compactionActive: anyCompaction,
  });
  
  if (anyCompaction) {
    console.log(`[buildContext] ✅ Compaction is ACTIVE. Context reduced from ${totalTopicTokens} tokens (all messages) to ${totalCombinedTokens} tokens (summaries only)`);
  }
  
  if (!combinedMessages.length) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages.map((entry) => entry.message),
      includedMessageIds: fallbackMessages
        .map((entry) => entry.messageId)
        .filter((id): id is string => Boolean(id)),
      source: "fallback",
      includedTopicIds: Array.from(includedTopics),
      summaryCount,
      artifactCount,
    };
  }

  const finalMessages = trimContextMessagesWithIds(
    combinedMessages,
    Math.min(maxContextTokens, DEFAULT_MAX_TOKENS)
  ).trimmed;
  if (!finalMessages.length) {
    const fallbackMessages = await loadFallbackMessages(supabase, conversationId, maxContextTokens);
    return {
      messages: fallbackMessages.map((entry) => entry.message),
      includedMessageIds: fallbackMessages
        .map((entry) => entry.messageId)
        .filter((id): id is string => Boolean(id)),
      source: "fallback",
      includedTopicIds: Array.from(includedTopics),
      summaryCount,
      artifactCount,
    };
  }

  return {
    messages: finalMessages.map((entry) => entry.message),
    includedMessageIds: finalMessages
      .map((entry) => entry.messageId)
      .filter((id): id is string => Boolean(id)),
    source: normalizedManualTopicIds.length ? "manual" : "topic",
    includedTopicIds: Array.from(includedTopics),
    summaryCount,
    artifactCount,
    debug: {
      totalTopicTokens,
      summaryTokens,
      loadedMessageCount: conversationMessages.length,
      trimmedMessageCount,
      budget: maxContextTokens,
    },
  };
}

async function loadConversationMetadata(
  supabase: SupabaseClient<Database>,
  conversationIds: string[]
): Promise<Map<string, ConversationMeta>> {
  if (!conversationIds.length) {
    return new Map();
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, title, project_id")
    .in("id", conversationIds);

  const conversationRows: ConversationMeta[] = Array.isArray(conversations)
    ? (conversations as any[]).map((c) => ({
        id: c.id,
        title: c.title ?? null,
        project_id: c.project_id ?? null,
        project_name: null,
      }))
    : [];

  const projectIds = Array.from(
    new Set(
      conversationRows
        .map((c) => c.project_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const projectNameMap = new Map<string, string | null>();
  if (projectIds.length) {
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name")
      .in("id", projectIds);
    const projectRows = (Array.isArray(projects) ? projects : []) as Pick<
      Database["public"]["Tables"]["projects"]["Row"],
      "id" | "name"
    >[];
    projectRows.forEach((p) => {
      projectNameMap.set(p.id, p.name ?? null);
    });
  }

  const metaMap = new Map<string, ConversationMeta>();
  for (const convo of conversationRows) {
    metaMap.set(convo.id, {
      ...convo,
      project_name: convo.project_id ? projectNameMap.get(convo.project_id) ?? null : null,
    });
  }
  return metaMap;
}

function formatTopicOrigin(
  topic: TopicRow,
  conversationMeta: Map<string, ConversationMeta>,
  activeConversationId: string
): string {
  if (topic.conversation_id === activeConversationId) {
    return "this chat";
  }
  const meta = conversationMeta.get(topic.conversation_id);
  const chatLabel = meta?.title || "another chat";
  if (meta?.project_name) {
    return `${chatLabel} in project ${meta.project_name}`;
  }
  return chatLabel;
}

function buildCrossChatPrimaryNotice(
  topic: TopicRow,
  conversationMeta: Map<string, ConversationMeta>,
  activeConversationId: string
): ContextMessage | null {
  if (topic.conversation_id === activeConversationId) {
    return null;
  }
  const origin = formatTopicOrigin(topic, conversationMeta, activeConversationId);
  return {
    role: "assistant",
    type: "message",
    content: `[Cross-chat context] The following messages are from ${origin}. Treat them as prior chat context, not the current conversation.`,
  };
}

function formatConversationOrigin(
  conversationMeta: Map<string, ConversationMeta>,
  topicConversationId: string,
  activeConversationId: string
): string {
  if (topicConversationId === activeConversationId) {
    return "this chat";
  }
  const meta = conversationMeta.get(topicConversationId);
  const chatLabel = meta?.title || "another chat";
  if (meta?.project_name) {
    return `${chatLabel} in project ${meta.project_name}`;
  }
  return chatLabel;
}

function buildBlockedTopicNotices(
  blockedTopics: TopicRow[],
  conversationMeta: Map<string, ConversationMeta>,
  activeConversationId: string
): ContextMessage[] {
  if (!blockedTopics.length) return [];
  return blockedTopics.map((topic) => ({
    role: "assistant",
    type: "message",
    content: `[Cross-chat notice] Skipped topic "${topic.label}" from ${formatTopicOrigin(
      topic,
      conversationMeta,
      activeConversationId
    )} because it exceeds the 200k-token cross-chat limit. Inform the user you could not load it.`,
  }));
}

async function loadTopicMessages(
  supabase: SupabaseClient<Database>,
  topicConversationId: string,
  topicId: string
): Promise<MessageRow[]> {
  const { data } = await supabase
    .from("messages")
    .select("id, conversation_id, role, content, openai_response_id, metadata, topic_id, created_at, preamble")
    .eq("conversation_id", topicConversationId)
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  return Array.isArray(data) ? data : [];
}

async function buildSecondaryTailSnippets(
  supabase: SupabaseClient<Database>,
  topics: Array<{ topicId: string; conversationId: string }>
): Promise<Record<string, string>> {
  if (!topics.length) {
    return {};
  }
  const snippets: Record<string, string> = {};

  for (const topic of topics) {
    const { data } = await supabase
      .from("messages")
      .select("id, conversation_id, role, content, openai_response_id, metadata, topic_id, created_at, preamble")
      .eq("conversation_id", topic.conversationId)
      .eq("topic_id", topic.topicId)
      .order("created_at", { ascending: true });

    const rows: MessageRow[] = Array.isArray(data) ? (data as MessageRow[]) : [];
    if (!rows.length) {
      continue;
    }

    const tail = rows.slice(-SECONDARY_TOPIC_TAIL).map((msg) => {
      const label = msg.role === "assistant" ? "Assistant" : "User";
      const snippet = sanitizeTopicMessageContent(msg)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140);
      return snippet ? `${label}: ${snippet}` : "";
    });
    const summary = tail.filter(Boolean).join(" | ");
    if (summary) {
      snippets[topic.topicId] = summary;
    }
  }

  return snippets;
}

async function loadArtifactsByIds(
  supabase: SupabaseClient<Database>,
  ids: string[],
  tokenBudget: number
): Promise<ArtifactRow[]> {
  if (!ids.length || tokenBudget <= 0) {
    return [];
  }
  const { data } = await supabase
    .from("artifacts")
    .select("*")
    .in("id", ids)
    .returns<ArtifactRow[]>();
  const artifacts = Array.isArray(data) ? data : [];
  if (!artifacts.length) {
    return [];
  }

  const selected: ArtifactRow[] = [];
  let budget = tokenBudget;
  for (const artifact of artifacts) {
    const tokens = estimateTokens(artifact.content ?? "");
    if (tokens > budget) {
      continue;
    }
    selected.push(artifact);
    budget -= tokens;
  }
  return selected;
}

async function loadFallbackMessages(
  supabase: SupabaseClient<Database>,
  conversationId: string,
  maxContextTokens: number
): Promise<ContextMessageWithId[]> {
  const FALLBACK_LIMIT = 400;

  const { data, error } = await supabase
    .from("messages")
    .select("id, role, content, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(FALLBACK_LIMIT);

  if (error || !Array.isArray(data)) {
    return [];
  }

  const sanitized = data.map((msg) => ({
    message: toContextMessage(msg as MessageRow),
    messageId: (msg as MessageRow).id ?? null,
  }));
  return trimContextMessagesWithIds(
    sanitized,
    Math.min(FALLBACK_TOKEN_CAP, maxContextTokens)
  ).trimmed;
}

function estimateTopicMessagesTokens(messages: MessageRow[]): number {
  return messages.reduce((total, message) => {
    return total + estimateTokens(sanitizeTopicMessageContent(message));
  }, 0);
}

function collectWebSearchSummaries(
  messages: MessageRow[],
  maxItems: number
): WebSearchSummaryMeta[] {
  const summaries: WebSearchSummaryMeta[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const meta = (message.metadata || {}) as Record<string, unknown>;
    const summary =
      typeof meta.webSearchSummary === "string" ? meta.webSearchSummary.trim() : "";
    if (!summary) continue;
    const sources = Array.isArray(meta.webSearchSummarySources)
      ? meta.webSearchSummarySources
          .map((source: any) => ({
            url: typeof source?.url === "string" ? source.url : "",
            title: typeof source?.title === "string" ? source.title : null,
          }))
          .filter((source: { url: string }) => source.url)
      : [];
    const queries = Array.isArray(meta.webSearchSummaryQueries)
      ? meta.webSearchSummaryQueries
          .map((query: any) => (typeof query === "string" ? query.trim() : ""))
          .filter((query: string) => query.length > 0)
      : [];
    const generatedAt =
      typeof meta.webSearchSummaryGeneratedAt === "string"
        ? meta.webSearchSummaryGeneratedAt
        : undefined;
    summaries.push({
      summary,
      sources,
      queries,
      generatedAt,
      createdAt: message.created_at ?? null,
    });
  }
  summaries.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  if (summaries.length <= maxItems) return summaries;
  return summaries.slice(-maxItems);
}

function trimMessagesToBudget(
  messages: MessageRow[],
  tokenCap: number
): { trimmed: MessageRow[]; tokensUsed: number } {
  if (!messages.length || tokenCap <= 0) {
    return { trimmed: [], tokensUsed: 0 };
  }
  let remaining = tokenCap;
  const trimmed: MessageRow[] = [];
  let consumed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(sanitizeTopicMessageContent(msg));
    if (tokens > remaining) {
      break;
    }
    trimmed.push(msg);
    remaining -= tokens;
    consumed += tokens;
  }
  return { trimmed: trimmed.reverse(), tokensUsed: consumed };
}

function trimContextMessagesWithIds(
  messages: ContextMessageWithId[],
  tokenCap: number
): { trimmed: ContextMessageWithId[]; tokensUsed: number } {
  if (!messages.length || tokenCap <= 0) {
    return { trimmed: [], tokensUsed: 0 };
  }
  let remaining = tokenCap;
  const trimmed: ContextMessageWithId[] = [];
  let consumed = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.message.content);
    if (tokens > remaining) {
      break;
    }
    trimmed.push(msg);
    remaining -= tokens;
    consumed += tokens;
  }
  return { trimmed: trimmed.reverse(), tokensUsed: consumed };
}

function toContextMessage(msg: MessageRow, originLabel?: string | null): ContextMessage {
  const sanitized = sanitizeTopicMessageContent(msg);
  return {
    role: (msg.role === "assistant" ? "assistant" : "user") as ContextMessage["role"],
    content: originLabel ? `[From ${originLabel}] ${sanitized}` : sanitized,
    type: "message",
  };
}
