"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import supabaseClient from "@/lib/supabase/browser-client";
import type { Database } from "@/lib/supabase/types";
import type { AssistantMessageMetadata } from "@/lib/chatTypes";

const STREAMING_ACTIVE_STORAGE_KEY = "llm-client:streaming-active";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  model?: string;
  metadata?: AssistantMessageMetadata | Record<string, unknown> | null;
  preamble?: string | null;
};

export type StoredChat = {
  id: string;
  title: string;
  timestamp: string;
  projectId?: string;
  source?: 'chatgpt' | 'claude';
  messages: StoredMessage[];
};

type ChatContextValue = {
  chats: StoredChat[];
  globalChats: StoredChat[];
  chatgptChats: StoredChat[];
  claudeChats: StoredChat[];
  getProjectChats: (projectId: string) => StoredChat[];
  refreshChats: () => Promise<void>;
  createChat: (options: {
    id?: string;
    projectId?: string;
    title?: string;
    initialMessages?: StoredMessage[];
  }) => string;
  appendMessages: (chatId: string, newMessages: StoredMessage[]) => void;
  prependMessages: (chatId: string, newMessages: StoredMessage[]) => void;
  updateMessage: (chatId: string, messageId: string, updates: Partial<StoredMessage>) => void;
  updateChatTitle: (chatId: string, title: string) => void;
  ensureChat: (chat: StoredChat) => void;
  removeMessage: (chatId: string, messageId: string) => void;
};

const ChatContext = createContext<ChatContextValue | null>(null);

const getTitleFromMessages = (messages: StoredMessage[], fallback = "New chat") => {
  const firstMessage = messages.find((msg) => msg.role === "user") ?? messages[0];
  return firstMessage?.content?.slice(0, 80) || fallback;
};

const parseTimestampMs = (timestamp?: string | null) => {
  if (!timestamp) return null;
  const ms = new Date(timestamp).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const mergeIncomingMessages = (
  incomingRaw?: StoredMessage[] | null,
  existingRaw?: StoredMessage[] | null
): StoredMessage[] => {
  const incomingBase = Array.isArray(incomingRaw) ? incomingRaw : [];
  const existing = Array.isArray(existingRaw) ? existingRaw : [];
  if (incomingBase.length === 0) return existing;
  if (existing.length === 0) return incomingBase;

  const streamingPlaceholders = existing.filter(
    (m) =>
      m?.id &&
      (m.id.startsWith("assistant-streaming-") || m.id.startsWith("assistant-preview-"))
  );
  const incoming = streamingPlaceholders.length
    ? incomingBase.filter((row) => {
        if (row.role !== "assistant") return true;
        const rowTs = parseTimestampMs(row.timestamp);
        if (rowTs === null) return true;
        const rowText = (row.content ?? "").trim();
        const overlapsPlaceholder = streamingPlaceholders.some((placeholder) => {
          const placeholderTs = parseTimestampMs(placeholder.timestamp);
          if (placeholderTs === null) return false;
          const deltaMs = Math.abs(rowTs - placeholderTs);
          if (deltaMs > 30_000) return false;
          const placeholderText = (placeholder.content ?? "").trim();
          if (!placeholderText || !rowText) return true;
          return (
            placeholderText.startsWith(rowText) ||
            rowText.startsWith(placeholderText)
          );
        });
        return !overlapsPlaceholder;
      })
    : incomingBase;

  const incomingIds = new Set(incoming.map((m) => m.id));
  const incomingTimes = incoming
    .map((m) => parseTimestampMs(m.timestamp))
    .filter((t): t is number => typeof t === "number");
  const oldestIncomingTsMs = incomingTimes.length ? Math.min(...incomingTimes) : null;
  const latestIncomingTsMs = incomingTimes.length ? Math.max(...incomingTimes) : null;

  const incomingAssistant = incoming.filter((m) => m.role === "assistant");
  const incomingAssistantTimes = incomingAssistant
    .map((m) => parseTimestampMs(m.timestamp))
    .filter((t): t is number => typeof t === "number");
  const latestIncomingAssistantTsMs = incomingAssistantTimes.length
    ? Math.max(...incomingAssistantTimes)
    : null;
  const incomingAssistantTexts = incomingAssistant
    .map((m) => (m.content ?? "").trim())
    .filter((text) => text.length > 0);

  const keepExisting = existing.filter((m) => {
    if (!m?.id) return false;
    if (incomingIds.has(m.id)) return false;

    const tsMs = parseTimestampMs(m.timestamp);
    const isAssistantStreaming =
      m.id.startsWith("assistant-streaming-") || m.id.startsWith("assistant-preview-");
    if (isAssistantStreaming) {
      if (
        tsMs !== null &&
        latestIncomingAssistantTsMs !== null &&
        latestIncomingAssistantTsMs < tsMs - 1000
      ) {
        return true;
      }
      const localText = (m.content ?? "").trim();
      // Allow empty placeholder if it's very recent (e.g. within 10 seconds)
      // or if there are no incoming assistant messages to replace it
      if (!localText) {
        if (tsMs !== null && Date.now() - tsMs < 10000) return true; // Keep if < 10s old
        return false;
      }
      const overlapping = incomingAssistantTexts.some(
        (serverText) => serverText.startsWith(localText) || localText.startsWith(serverText)
      );
      return !overlapping;
    }

    if (m.id.startsWith("user-")) {
      if (tsMs === null) return false;
      if (latestIncomingTsMs === null) return true;
      return tsMs > latestIncomingTsMs + 1500;
    }

    if (tsMs === null) return true;
    if (oldestIncomingTsMs !== null && tsMs < oldestIncomingTsMs - 1000) return true;
    if (latestIncomingTsMs !== null && tsMs > latestIncomingTsMs + 1000) return true;
    return false;
  });

  const combined = [...incoming, ...keepExisting];
  return combined
    .map((msg, idx) => ({
      msg,
      idx,
      ts: parseTimestampMs(msg.timestamp),
    }))
    .sort((a, b) => {
      if (a.ts === null && b.ts === null) return a.idx - b.idx;
      if (a.ts === null) return 1;
      if (b.ts === null) return -1;
      if (a.ts === b.ts) return a.idx - b.idx;
      return a.ts - b.ts;
    })
    .map((entry) => entry.msg);
};

interface ChatProviderProps {
  children: React.ReactNode;
  initialChats?: StoredChat[];
  userId: string;
}

export function ChatProvider({ children, initialChats = [], userId }: ChatProviderProps) {
  const [chats, setChats] = useState<StoredChat[]>(initialChats);

  // Refresh chats from Supabase client-side (used for manual refresh or initial hydration fallback)
  const refreshChats = useCallback(async () => {
    try {
      if (!userId) return;

      type ConversationRow = Database["public"]["Tables"]["conversations"]["Row"];

      const query = supabaseClient
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      const { data, error } = await query.returns<ConversationRow[]>();

      if (error) {
        console.warn("Failed to refresh conversations", error);
        return;
      }

      const rows = (data ?? []).filter((row) => {
        const agent = (row.metadata as any)?.agent;
        return agent !== "human-writing" && agent !== "market-agent" && agent !== "sga";
      });
      const conversationIds = rows.map((row) => row.id);
      const { data: messageRows } = await supabaseClient
        .from("messages")
        .select("*")
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
        .returns<Database["public"]["Tables"]["messages"]["Row"][]>();

      const messageMap = new Map<string, StoredMessage[]>();
      const latestMessageTime = new Map<string, string>();
      (messageRows ?? []).forEach((msg) => {
        const convId = msg.conversation_id;
        if (!convId) return;
        const messages = messageMap.get(convId) ?? [];
        const timestamp = msg.created_at ?? new Date().toISOString();
        messages.push({
          id: msg.id,
          role: (msg.role as "user" | "assistant") || "assistant",
          content: msg.content ?? "",
          timestamp,
          metadata: msg.metadata as AssistantMessageMetadata | Record<string, unknown> | null,
          preamble: (msg as any).preamble ?? null,
        });
        messageMap.set(convId, messages);
        latestMessageTime.set(convId, timestamp);
      });

      // Preserve existing messages for chats already in memory; don't wipe messages to [] on refresh
      setChats((prev) => {
        const prevById = new Map(prev.map((c) => [c.id, c] as const));
        const merged: StoredChat[] = rows.map((row) => {
          const existing = prevById.get(row.id);
          const lastActivity = latestMessageTime.get(row.id) ?? row.created_at ?? existing?.timestamp ?? new Date().toISOString();
          const metadata = row.metadata as { source?: 'chatgpt' | 'claude' } | null;
          const source = metadata?.source ?? existing?.source ?? undefined;
          return {
            id: row.id,
            title: row.title ?? existing?.title ?? "Untitled chat",
            timestamp: lastActivity,
            projectId: row.project_id ?? existing?.projectId ?? undefined,
            source,
            messages: mergeIncomingMessages(messageMap.get(row.id), existing?.messages ?? []),
          };
        });
        merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return merged;
      });
    } catch (err) {
      console.warn("refreshChats error", err);
    }
  }, [userId]);

  const createChat = useCallback(
    ({ id, projectId, title, initialMessages = [] }: {
      id?: string;
      projectId?: string;
      title?: string;
      initialMessages?: StoredMessage[];
    }) => {
      const chatId = id ?? `chat-${Date.now()}`;
      const now = new Date().toISOString();
      const derivedTitle = title || getTitleFromMessages(initialMessages);

      const newChat: StoredChat = {
        id: chatId,
        title: derivedTitle,
        timestamp: now,
        projectId,
        messages: initialMessages,
      };

      setChats((prev) => [newChat, ...prev]);
      return chatId;
    },
    []
  );

  const appendMessages = useCallback((chatId: string, newMessages: StoredMessage[]) => {
    if (!newMessages.length) return;
    setChats((prev) => {
      const existingIndex = prev.findIndex((chat) => chat.id === chatId);
      if (existingIndex === -1) {
        const now = new Date().toISOString();
        const newChat: StoredChat = {
          id: chatId,
          title: getTitleFromMessages(newMessages),
          timestamp: now,
          projectId: undefined,
          messages: newMessages,
        };
        const next = [newChat, ...prev];
        next.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return next;
      }

      return prev.map((chat) => {
        if (chat.id !== chatId) return chat;

        const updatedMessages = [...chat.messages, ...newMessages];
        return {
          ...chat,
          messages: updatedMessages,
          timestamp: new Date().toISOString(),
          title:
            chat.messages.length === 0 && newMessages.length > 0
              ? getTitleFromMessages(newMessages, chat.title)
              : chat.title,
        };
      });
    });
  }, []);

  const prependMessages = useCallback((chatId: string, newMessages: StoredMessage[]) => {
    if (!newMessages.length) return;
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        const existingIds = new Set(chat.messages.map((msg) => msg.id));
        const uniqueIncoming = newMessages.filter((msg) => !existingIds.has(msg.id));
        if (!uniqueIncoming.length) return chat;
        return {
          ...chat,
          messages: [...uniqueIncoming, ...chat.messages],
        };
      })
    );
  }, []);

  const updateMessage = useCallback(
    (chatId: string, messageId: string, updates: Partial<StoredMessage>) => {
      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== chatId) return chat;

          const messageIndex = chat.messages.findIndex((m) => m.id === messageId);
          if (messageIndex < 0) return chat;

          const updateKeys = Object.keys(updates);
          if (updateKeys.length === 0) return chat;

          const currentMessage = chat.messages[messageIndex];
          const hasChanges = updateKeys.some(
            (key) => (currentMessage as Record<string, unknown>)[key] !== (updates as Record<string, unknown>)[key]
          );
          if (!hasChanges) return chat;

          const updatedMessages = [...chat.messages];
          updatedMessages[messageIndex] = {
            ...currentMessage,
            ...updates,
          };

          return {
            ...chat,
            messages: updatedMessages,
          };
        })
      );
    },
    []
  );

  const removeMessage = useCallback((chatId: string, messageId: string) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          messages: chat.messages.filter((m) => m.id !== messageId),
          timestamp: new Date().toISOString(),
        };
      })
    );
  }, []);

  const updateChatTitle = useCallback((chatId: string, title: string) => {
    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== chatId) return chat;
        return {
          ...chat,
          title,
        };
      })
    );
  }, []);

  // Subscribe to realtime updates (conversations + messages) and apply changes to the local store.
  useEffect(() => {
    // If supabase client is not configured or no user id, skip
    if (!supabaseClient || !userId) return;

    const convChannel = supabaseClient
      .channel("public:conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as Database["public"]["Tables"]["conversations"]["Row"] | null;
          const oldRow = payload.old as Database["public"]["Tables"]["conversations"]["Row"] | null;
          const agent = (newRow?.metadata as any)?.agent;
          const isExcluded = agent === "human-writing" || agent === "market-agent" || agent === "sga";

          if (payload.eventType === "INSERT" && newRow) {
            if (isExcluded) return;
            setChats((prev) => {
              const existing = prev.find((c) => c.id === newRow.id);
              const metadata = newRow.metadata as { source?: 'chatgpt' | 'claude' } | null;
              const toAdd: StoredChat = {
                id: newRow.id,
                title: newRow.title ?? existing?.title ?? "Untitled chat",
                timestamp: newRow.created_at ?? existing?.timestamp ?? new Date().toISOString(),
                projectId: newRow.project_id ?? existing?.projectId ?? undefined,
                source: metadata?.source ?? existing?.source ?? undefined,
                messages: existing?.messages ?? [],
              };
              const filtered = prev.filter((c) => c.id !== toAdd.id);
              return [toAdd, ...filtered];
            });
            return;
          }

          if (payload.eventType === "UPDATE" && newRow) {
            if (isExcluded) {
              setChats((prev) => prev.filter((c) => c.id !== newRow.id));
              return;
            }
            const metadata = newRow.metadata as { source?: 'chatgpt' | 'claude' } | null;
            setChats((prev) =>
              prev.map((c) => (c.id === newRow.id ? { ...c, title: newRow.title ?? c.title, timestamp: newRow.created_at ?? c.timestamp, projectId: newRow.project_id ?? c.projectId, source: metadata?.source ?? c.source } : c))
            );
            return;
          }

          if (payload.eventType === "DELETE" && oldRow) {
            setChats((prev) => prev.filter((c) => c.id !== oldRow.id));
            return;
          }
        }
      )
      .subscribe();

    const msgChannel = supabaseClient
      .channel("public:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Database["public"]["Tables"]["messages"]["Row"] | null;
          if (!m) return;

          // Only apply if we already have the chat in the store. Ignore otherwise.
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;

            const existing = prev[idx];

            const incomingContent = m.content ?? "";
            const incomingTimestamp = m.created_at ?? new Date().toISOString();

            const incomingRole = (m.role as "user" | "assistant") || "assistant";

            // If we have a temporary placeholder that matches this inserted message,
            // upgrade it to the persisted ID so future UPDATE events apply.
            // For assistant streams we intentionally allow looser matching because the
            // client placeholder may already contain partial tokens when the server INSERT happens.
            const tempIndex = existing.messages.findIndex((msg) => {
              const isEphemeral =
                msg.id.startsWith("user-") || msg.id.startsWith("assistant-streaming-");
              if (!isEphemeral) return false;
              if (msg.role !== incomingRole) return false;

              const deltaMs = Math.abs(
                new Date(msg.timestamp).getTime() - new Date(incomingTimestamp).getTime()
              );
              if (!Number.isFinite(deltaMs) || deltaMs > 30_000) return false;

              if (msg.id.startsWith("assistant-streaming-") && incomingRole === "assistant") {
                // Looser: allow either side to be prefix of the other (or empty server placeholder).
                const a = (msg.content ?? "").trim();
                const b = incomingContent.trim();
                if (!a || !b) return true;
                if (a.startsWith(b) || b.startsWith(a)) return true;
                // Fallback: if it's the last assistant-streaming message, treat it as the same one.
                const lastStreamingIndex = (() => {
                  for (let i = existing.messages.length - 1; i >= 0; i -= 1) {
                    if (existing.messages[i].id.startsWith("assistant-streaming-")) return i;
                  }
                  return -1;
                })();
                return lastStreamingIndex === existing.messages.indexOf(msg);
              }

              // User placeholder requires stricter match
              return msg.content === incomingContent && deltaMs < 1500;
            });

            if (tempIndex >= 0) {
              const next = [...prev];
              const nextMessages = [...existing.messages];
              nextMessages[tempIndex] = {
                ...nextMessages[tempIndex],
                id: m.id,
                timestamp: incomingTimestamp,
                metadata: m.metadata as AssistantMessageMetadata | Record<string, unknown> | null | undefined,
                preamble: (m as any).preamble ?? null,
              };

              // If the inserted row has non-empty content and the placeholder is still empty (or shorter),
              // prefer the server content.
              if (incomingContent && incomingContent.length >= (nextMessages[tempIndex].content ?? "").length) {
                nextMessages[tempIndex].content = incomingContent;
              }
              next[idx] = {
                ...existing,
                messages: nextMessages,
                timestamp: new Date().toISOString(),
              };
              return next;
            }

            // Check if this message is already in the chat (avoid duplicates)
            if (existing.messages.some((msg) => msg.id === m.id)) {
              return prev;
            }
            
            const newMessage: StoredMessage = {
              id: m.id,
              role: (m.role as "user" | "assistant") || "assistant",
              content: incomingContent,
              timestamp: incomingTimestamp,
              metadata: m.metadata as AssistantMessageMetadata | Record<string, unknown> | null | undefined,
              preamble: (m as any).preamble ?? null,
            };

            const updated: StoredChat = {
              ...existing,
              messages: [...existing.messages, newMessage],
              timestamp: new Date().toISOString(),
            };
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as Database["public"]["Tables"]["messages"]["Row"] | null;
          if (!m) return;

          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;

            const existing = prev[idx];
            const messageIndex = existing.messages.findIndex((msg) => msg.id === m.id);
            if (messageIndex === -1) return prev;

            const next = [...prev];
            const nextMessages = [...existing.messages];
            nextMessages[messageIndex] = {
              ...nextMessages[messageIndex],
              content: m.content ?? "",
              timestamp: m.created_at ?? nextMessages[messageIndex].timestamp,
              metadata: m.metadata as AssistantMessageMetadata | Record<string, unknown> | null | undefined,
              preamble: (m as any).preamble ?? nextMessages[messageIndex].preamble ?? null,
            };

            next[idx] = {
              ...existing,
              messages: nextMessages,
              timestamp: new Date().toISOString(),
            };
            return next;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.old as Database["public"]["Tables"]["messages"]["Row"] | null;
          if (!m) return;

          // Remove the deleted message from the chat
          setChats((prev) => {
            const idx = prev.findIndex((c) => c.id === m.conversation_id);
            if (idx === -1) return prev;

            const existing = prev[idx];
            const updated: StoredChat = {
              ...existing,
              messages: existing.messages.filter((msg) => msg.id !== m.id),
              timestamp: new Date().toISOString(),
            };
            const next = [...prev];
            next[idx] = updated;
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      try {
        convChannel.unsubscribe();
      } catch {}
      try {
        msgChannel.unsubscribe();
      } catch {}
    };
  }, [userId]);

  // Ensure we hydrate from Supabase on initial client mount so the UI shows
  // the latest conversations even when server-rendered props are missing.
  useEffect(() => {
    // Only attempt to refresh if we don't already have chats loaded.
    // This allows server-provided initialChats to remain authoritative on first paint,
    // but will fetch latest data for fresh page loads.
    if (!userId) return;
    refreshChats().catch((err) => {
      // swallow errors in client-side hydration to avoid breaking UI
      console.warn("chat-provider: refreshChats failed", err);
    });
    // We intentionally do not add `chats` here: we want this to run once on mount
  }, [refreshChats, userId]);

  // Also refresh chats when tab regains focus/visibility (helps when changes are made elsewhere)
  useEffect(() => {
    const onFocus = () => {
      try {
        if (window.sessionStorage.getItem(STREAMING_ACTIVE_STORAGE_KEY) === "1") return;
      } catch {}
      if (userId) refreshChats().catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && userId) {
        try {
          if (window.sessionStorage.getItem(STREAMING_ACTIVE_STORAGE_KEY) === "1") return;
        } catch {}
        refreshChats().catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshChats, userId]);

  const ensureChat = useCallback((chat: StoredChat) => {
    setChats((prev) => {
      const existingIndex = prev.findIndex((existing) => existing.id === chat.id);

      // Insert new chat and keep list sorted by timestamp (desc)
      if (existingIndex === -1) {
        const next = [chat, ...prev];
        next.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        return next;
      }

      const existing = prev[existingIndex];
      
      // When messages come from server (e.g., on page load), they have the authoritative metadata
      // Only keep existing messages if they're not present in the incoming batch
      const mergedMessages =
        chat.messages.length === 0
          ? existing.messages
          : mergeIncomingMessages(chat.messages, existing.messages);

      const incomingTs = chat.timestamp || existing.timestamp || new Date().toISOString();
      const existingTs = existing.timestamp || incomingTs;
      const chosenTimestamp =
        new Date(incomingTs).getTime() >= new Date(existingTs).getTime()
          ? incomingTs
          : existingTs;

      const updated: StoredChat = {
        ...existing,
        ...chat,
        title: chat.title || existing.title,
        timestamp: chosenTimestamp,
        messages: mergedMessages,
      };

      if (
        updated.title === existing.title &&
        updated.timestamp === existing.timestamp &&
        updated.projectId === existing.projectId &&
        updated.messages === existing.messages
      ) {
        return prev;
      }

      const next = [...prev];
      next[existingIndex] = updated;
      next.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return next;
    });
  }, []);

  const getProjectChats = useCallback(
    (projectId: string) => chats.filter((chat) => chat.projectId === projectId),
    [chats]
  );

  const value = useMemo(
    () => ({
      chats,
      globalChats: chats.filter((chat) => !chat.projectId && !chat.source),
      chatgptChats: chats.filter((chat) => chat.source === 'chatgpt'),
      claudeChats: chats.filter((chat) => chat.source === 'claude'),
      getProjectChats,
      refreshChats,
      createChat,
      appendMessages,
      prependMessages,
      updateMessage,
      updateChatTitle,
      ensureChat,
      removeMessage,
    }),
    [
      appendMessages,
      prependMessages,
      chats,
      createChat,
      ensureChat,
      getProjectChats,
      refreshChats,
      updateMessage,
      updateChatTitle,
      removeMessage,
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatStore() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChatStore must be used within a ChatProvider");
  }
  return ctx;
}
