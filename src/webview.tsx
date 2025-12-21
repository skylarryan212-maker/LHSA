"use client";

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { History, LogOut, Plus, Settings } from "lucide-react";
import { ChatComposer } from "./components/chat/composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "./components/ui/dropdown-menu";

type Message = {
  role: "user" | "assistant";
  text: string;
};

type PanelMessage =
  | { type: "init"; authenticated?: boolean }
  | { type: "loggedIn" }
  | { type: "loggedOut" }
  | { type: "userInfo"; payload?: { email?: string; plan?: string } };

const styles = `
    :root {
        color-scheme: dark;
        --font-sans: 'Geist', 'Geist Fallback', 'Segoe UI', system-ui, sans-serif;
        --text-primary: #e7e9ee;
        --text-muted: #cfd3dd;
        font-family: var(--font-sans);
    }
    html, body, #root {
        height: 100%;
    }
    * { box-sizing: border-box; }
    body {
        margin: 0;
        min-height: 100vh;
        background: #070707;
        color: var(--text-primary);
        display: flex;
        flex-direction: column;
        align-items: stretch;
        overflow: hidden;
    }
    .top-bar {
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 48px;
        padding: 8px 16px;
        display: flex;
        justify-content: flex-end;
        align-items: center;
        background: #070707;
        z-index: 3;
    }
    .toolbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .toolbar-icon {
        width: 30px;
        height: 30px;
        display: grid;
        place-items: center;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease;
    }
    .toolbar-icon:hover {
        background: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.18);
    }
    .toolbar-icon svg { width: 16px; height: 16px; stroke: #cfd3dd; stroke-width: 1.6; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .status-wrapper { height: 48px; }
    .dropdown-content {
        background: #09090b;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.08);
        padding: 10px 8px;
        min-width: 260px;
        box-shadow: 0 20px 50px rgba(0,0,0,0.45);
        z-index: 5;
    }
    .dropdown-label {
        padding: 6px 10px 2px;
        font-size: 0.9rem;
        font-weight: 600;
        color: #cfd3dd;
        letter-spacing: 0.05em;
    }
    .dropdown-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
    }
    .dropdown-item:hover {
        background: rgba(255,255,255,0.04);
    }
    .dropdown-item-text {
        display: flex;
        flex-direction: column;
        gap: 4px;
        flex: 1;
        min-width: 0;
    }
    .dropdown-item-label {
        font-weight: 600;
        color: #e7e9ee;
        font-size: 0.95rem;
    }
    .dropdown-item-description {
        font-size: 0.78rem;
        color: #cfd3dd;
    }
    .dropdown-account {
        padding: 6px 10px 8px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .dropdown-account-email {
        color: #e7e9ee;
        font-weight: 600;
        font-size: 0.95rem;
        word-break: break-word;
    }
    .dropdown-account-plan {
        color: #9aa0ad;
        font-size: 0.85rem;
    }
    .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        padding-top: 48px;
        overflow: hidden;
    }
    .messages {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding: 16px 22px 140px;
        min-height: 0;
        overflow-y: auto;
    }
    .messages-inner { width: min(768px, calc(100% - 40px)); margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
    .message-row { display: flex; }
    .message-row.user { justify-content: flex-end; }
    .message-bubble { max-width: min(70%, 520px); background: #121212; border: 1px solid #1E1E1E; color: #e7e9ee; padding: 10px 14px; border-radius: 16px; font-size: 0.95rem; line-height: 1.4; }
    .assistant-line { max-width: min(70%, 520px); color: #cfd3dd; font-size: 0.95rem; line-height: 1.4; }
    .composer-panel {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        background: #070707;
        padding: 6px 0 12px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2;
    }
    .composer-wrapper { width: min(820px, calc(100% - 24px)); margin: 0 auto; }
    .composer-form { display: flex; flex-direction: column; gap: 8px; width: 100%; }
    .composer-shell {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 20px;
        border: 1px solid #262626;
        background: #0A0A0A;
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.52);
        transition: border 0.2s ease, box-shadow 0.2s ease;
    }
    .composer-textarea {
        flex: 1;
        height: 32px;
        border: none;
        background: #0A0A0A;
        color: #f1f3f7;
        font-size: 1rem;
        font-family: inherit;
        line-height: 32px;
        resize: none;
        letter-spacing: 0.01em;
        padding: 0;
        margin: 0;
    }
    .composer-textarea:focus { outline: none; }
    .composer-actions { display: flex; gap: 8px; align-items: center; }
    .composer-send-button {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        background: linear-gradient(135deg, #f8fbfe, #d6e6ff);
        color: #0b0c11;
        display: grid;
        place-items: center;
        cursor: pointer;
        box-shadow: 0 16px 26px rgba(8, 10, 25, 0.35);
        transition: transform 0.15s ease, box-shadow 0.2s ease;
    }
    .composer-send-button:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
    .composer-send-button:not(:disabled):active { transform: translateY(1px); }
    .composer-shell:focus-within {
        border-color: #525252;
        box-shadow: 0 0 0 1px #525252, 0 0 0 3px #282b54;
    }
    .login-stage {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        padding: 24px;
        color: #e7e9ee;
    }
    .login-stage h1 { margin: 0; }
    .login-actions { display: flex; gap: 10px; }
    .login-actions .filled { background: #0b84ff; color: #fff; border: none; padding: 10px 16px; border-radius: 12px; cursor: pointer; }
    .login-actions .secondary { background: transparent; color: #9aa0ad; border: 1px solid #1e1e1e; padding: 10px 16px; border-radius: 12px; }
    @keyframes pulse {
        0% {
            opacity: 0.8;
        }
        100% {
            opacity: 0;
        }
    }
`;

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
      <style>{styles}</style>
      <div className="top-bar">{StatusIcons}</div>
      <div className="content">
        {!authenticated ? (
          <div className="login-stage">
            <h1>Log in to LLM Client</h1>
            <p>
              Authenticate through your LLM Client account and the extension
              will remember your session.
            </p>
            <div className="login-actions">
              <button
                className="filled"
                type="button"
                onClick={() => {
                  setLoginStatus("Opening the LLM Client login flow...");
                  vscodeApi?.postMessage({ type: "openAuth" });
                }}
              >
                Log in with LLM Client
              </button>
              <button className="secondary" type="button" disabled>
                Use API Key
              </button>
            </div>
            <div className="login-actions">
              <span style={{ color: "#9aa0ad", fontSize: "0.85rem" }}>
                {loginStatus}
              </span>
              <button
                className="secondary"
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
        ) : (
          <>
            <div className="messages" ref={messagesRef}>
              <div className="messages-inner">
                {messages.map((message, index) => (
                  <div
                    className={`message-row ${
                      message.role === "user" ? "user" : ""
                    }`}
                    key={`${message.role}-${index}`}
                  >
                    {message.role === "user" ? (
                      <div className="message-bubble">{message.text}</div>
                    ) : (
                      <div className="assistant-line">{message.text}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="composer-panel">
              <div className="composer-wrapper">
                <ChatComposer onSend={sendPrompt} authenticated={authenticated} />
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
