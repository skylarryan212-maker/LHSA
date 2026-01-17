"use client";

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import css from "./webview.css";
import { createRoot } from "react-dom/client";
import { History, LogOut, Plus, Settings, ArrowUp } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./components/ui/dropdown-menu";

type Message = { role: "user" | "assistant"; text: string };

type PanelMessage =
  | { type: "init"; authenticated?: boolean }
  | { type: "loggedIn" }
  | { type: "loggedOut" }
  | { type: "userInfo"; payload?: { email?: string; plan?: string } };

const vscodeApi =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginStatus, setLoginStatus] = useState(
    "Waiting for you to initiate the login flow."
  );
  const [userInfo, setUserInfo] = useState<{ email?: string; plan?: string }>({});
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const mockReplies = useMemo(
    () => [
      "Got it. Working through the request now.",
      "Understood. I will outline next steps shortly.",
      "Acknowledged. Preparing a response.",
      "Thanks. I will draft a proposal.",
      "Received. I am reviewing and will respond.",
    ],
    []
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as PanelMessage;
      switch (data.type) {
        case "init": {
          setAuthenticated(!!data.authenticated);
          if (data.authenticated) {
            vscodeApi?.postMessage({ type: "requestUserInfo" });
          }
          break;
        }
        case "loggedIn": {
          setAuthenticated(true);
          setLoginStatus("Login successful. You can close the browser tab.");
          vscodeApi?.postMessage({ type: "requestUserInfo" });
          break;
        }
        case "loggedOut": {
          setAuthenticated(false);
          setLoginStatus("Logged out. Please log in again.");
          break;
        }
        case "userInfo": {
          setUserInfo(data.payload ?? {});
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    vscodeApi?.postMessage({ type: "webviewReady" });
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const scrollToLatest = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      requestAnimationFrame(() => {
        const container = messagesRef.current;
        if (!container) {
          return;
        }
        container.scrollTo({ top: container.scrollHeight, behavior });
      });
    },
    []
  );

  const sendPrompt = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed || !authenticated) {
        return;
      }
      vscodeApi?.postMessage({ type: "sendCommand", value: trimmed });
      setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
      const reply =
        mockReplies[Math.floor(Math.random() * mockReplies.length)];
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
        scrollToLatest("smooth");
      }, 350);
      scrollToLatest("auto");
    },
    [authenticated, mockReplies, scrollToLatest]
  );

  const [composerValue, setComposerValue] = useState("");

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (composerValue.trim()) {
      sendPrompt(composerValue);
      setComposerValue("");
    }
  }, [composerValue, sendPrompt]);

  useEffect(() => {
    if (!messages.length) {
      return;
    }
    scrollToLatest("auto");
  }, [messages, scrollToLatest]);

  useEffect(() => {
    if (authenticated) {
      vscodeApi?.postMessage({ type: "requestUserInfo" });
    }
  }, [authenticated]);

  const formattedPlan = useMemo(() => {
    const raw = userInfo.plan?.toLowerCase().trim();
    if (!raw) return "Plus";
    if (raw === "dev" || raw === "max") return "Max";
    if (raw === "plus") return "Plus";
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [userInfo.plan]);

  const StatusIcons = (
    <div className="toolbar-right">
      <button className="toolbar-icon" id="historyButton" aria-label="History" type="button">
        <History size={16} color="#cfd3dd" />
      </button>
      <button
        className="toolbar-icon"
        id="newChatButton"
        aria-label="New chat"
        type="button"
        onClick={() => vscodeApi?.postMessage({ type: "newChat" })}
      >
        <Plus size={16} color="#cfd3dd" />
      </button>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            vscodeApi?.postMessage({ type: "requestUserInfo" });
          }
        }}
      >
        <DropdownMenuTrigger asChild onPointerDownCapture={() => vscodeApi?.postMessage({ type: "requestUserInfo" })}>
          <button className="toolbar-icon" aria-label="Settings" type="button">
            <Settings size={16} color="#cfd3dd" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="dropdown-content"
        >
          <DropdownMenuLabel className="dropdown-label">Account</DropdownMenuLabel>
          <div className="dropdown-account">
            <div className="dropdown-account-email">{userInfo.email ?? "Unknown user"}</div>
            <div className="dropdown-account-plan">Plan: {formattedPlan}</div>
          </div>
          <DropdownMenuItem
            className="dropdown-item"
            onSelect={(event) => {
              event.preventDefault();
              vscodeApi?.postMessage({ type: "logout" });
            }}
          >
            <div className="dropdown-item-text">
              <span className="dropdown-item-label">Log out</span>
              <span className="dropdown-item-description">Sign out of this account</span>
            </div>
            <LogOut size={16} color="#cfd3dd" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <>
      <style>{css}</style>
      <div className="dark quarry-theme">
        <div className="flex flex-col h-screen bg-background text-foreground">
          {/* Top Navigation Bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Quarry</h1>
            </div>
            <div className="flex items-center gap-1">{StatusIcons}</div>
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!authenticated ? (
              <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
                <div className="max-w-md text-center space-y-4">
                  <h2 className="text-2xl font-bold">Log in to LLM Client</h2>
                  <p className="text-muted-foreground">
                    Authenticate through your LLM Client account and the extension
                    will remember your session.
                  </p>
                  <div className="flex flex-col gap-3 mt-6">
                    <button
                      className="px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity font-medium"
                      type="button"
                      onClick={() => {
                        setLoginStatus("Opening the LLM Client login flow...");
                        vscodeApi?.postMessage({ type: "openAuth" });
                      }}
                    >
                      Log in with LLM Client
                    </button>
                    <button
                      className="px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg opacity-50 cursor-not-allowed font-medium"
                      type="button"
                      disabled
                    >
                      Use API Key
                    </button>
                  </div>
                  <div className="flex flex-col gap-2 mt-4">
                    <span className="text-sm text-muted-foreground">
                      {loginStatus}
                    </span>
                    <button
                      className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm"
                      type="button"
                      onClick={() => {
                        setLoginStatus("Finishing login...");
                        vscodeApi?.postMessage({ type: "authComplete" });
                      }}
                    >
                      Already completed login? Continue
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Messages Container */}
                <div className="flex-1 overflow-y-auto" ref={messagesRef}>
                  <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
                    {messages.length === 0 && (
                      <div className="flex flex-col items-center justify-center text-center py-12">
                        <h2 className="text-4xl font-bold tracking-tight mb-2">Quarry</h2>
                        <p className="text-muted-foreground">Ask me anything</p>
                      </div>
                    )}
                    {messages.map((message, index) => (
                      <div
                        className={`flex ${
                          message.role === "user" ? "justify-end" : "justify-start"
                        }`}
                        key={`${message.role}-${index}`}
                      >
                        {message.role === "user" ? (
                          <div className="bg-accent text-accent-foreground px-4 py-3 rounded-2xl max-w-[85%] break-words">
                            {message.text}
                          </div>
                        ) : (
                          <div className="text-foreground max-w-[85%] break-words">
                            {message.text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Composer at Bottom */}
                <div className="border-t border-border bg-card shrink-0">
                  <div className="max-w-3xl mx-auto px-4 py-4">
                    <form onSubmit={handleSubmit} className="relative">
                      <textarea
                        className="w-full px-4 py-3 pr-12 bg-input border border-border rounded-2xl resize-none text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        placeholder="Ask Quarry..."
                        rows={1}
                        value={composerValue}
                        onChange={(e) => setComposerValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit(e);
                          }
                        }}
                        style={{
                          minHeight: "48px",
                          maxHeight: "200px"
                        }}
                      />
                      <button
                        type="submit"
                        disabled={!composerValue.trim()}
                        className="absolute right-3 bottom-3 p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ArrowUp size={18} />
                      </button>
                    </form>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
