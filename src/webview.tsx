"use client";

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

import { Suspense, useEffect, useMemo } from "react";
import css from "./webview.css";
import { createRoot } from "react-dom/client";
import ChatPageShell from "./components/chat/chat-page-shell";
import { LoginOverlay } from "./components/auth/login-overlay";
import { useLoginModal, LoginProvider } from "./lib/auth/login-context";
import { ProjectsProvider } from "./components/projects/projects-provider";
import { ChatProvider, type StoredChat } from "./components/chat/chat-provider";
import { AccentColorProvider } from "./components/accent-color-provider";
import { UserIdentityProvider, type UserIdentity } from "./components/user-identity-provider";
import { UsageSnapshotProvider, type UsageSnapshot } from "./components/usage-snapshot-provider";
import { LocationPermissionWrapper } from "./components/location-permission-wrapper";
import { OptionalSpeedInsights } from "./lib/speedInsights";
import { PerformanceMonitor } from "./components/performance-monitor";

const vscodeApi =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

// If an inline script queued events before the bundle loaded, flush them now
// and replace the queue with a forwarder so future pushes go straight to the
// acquired API.
if (typeof window !== "undefined") {
  const anyWin = window as any;
  try {
    if (vscodeApi && Array.isArray(anyWin.__lhsa_event_queue)) {
      anyWin.__lhsa_event_queue.forEach((ev: any) => {
        try {
          vscodeApi.postMessage(ev);
        } catch (err) {
          // swallow so we don't break the app during startup
          console.error("Failed to post queued webview event:", err);
        }
      });
    }
  } catch (err) {
    console.error("Error flushing __lhsa_event_queue:", err);
  }

  // Forward future queued events directly to the extension host
  anyWin.__lhsa_event_queue = {
    push: (m: any) => {
      try {
        if (vscodeApi) vscodeApi.postMessage(m);
      } catch (err) {
        console.error("Failed to forward queued webview event:", err);
      }
      return 0;
    },
  };
}

const EMPTY_IDENTITY: UserIdentity = {
  userId: null,
  fullName: null,
  email: null,
  avatarUrl: null,
  isGuest: true,
  tokenAuth: false,
};

const EMPTY_USAGE: UsageSnapshot = null;

const EMPTY_CHATS: StoredChat[] = [];

function HomeShell() {
  const { isLoginModalOpen } = useLoginModal();
  const searchParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search ?? "");
  }, []);
  const searchParamsObject = useMemo(() => {
    const entries = Array.from(searchParams.entries());
    return entries.reduce<Record<string, string | string[]>>((acc, [key, value]) => {
      if (acc[key]) {
        const existing = acc[key];
        acc[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});
  }, [searchParams]);
  const showLogin =
    isLoginModalOpen ||
    searchParams.get("login") === "1" ||
    searchParams.get("auth") === "1";

  return (
    <>
      <ChatPageShell
        conversations={[]}
        activeConversationId={null}
        messages={[]}
        searchParams={searchParamsObject}
      />
      {showLogin ? <LoginOverlay /> : null}
    </>
  );
}

function App() {
  useEffect(() => {
    document.body.classList.add("dark", "quarry-theme");
    return () => {
      document.body.classList.remove("dark", "quarry-theme");
    };
  }, []);

  return (
    <>
      <style>{css}</style>
      <main className="h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-background">
        <UserIdentityProvider identity={EMPTY_IDENTITY}>
          <UsageSnapshotProvider value={EMPTY_USAGE}>
            <AccentColorProvider initialAccentColor="white">
              <LoginProvider>
                <ProjectsProvider initialProjects={[]} userId="">
                  <ChatProvider initialChats={EMPTY_CHATS} userId="">
                    <PerformanceMonitor />
                    <LocationPermissionWrapper />
                    <OptionalSpeedInsights />
                    <Suspense fallback={null}>
                      <HomeShell />
                    </Suspense>
                  </ChatProvider>
                </ProjectsProvider>
              </LoginProvider>
            </AccentColorProvider>
          </UsageSnapshotProvider>
        </UserIdentityProvider>
      </main>
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  // Ensure theme classes exist on first paint so CSS variables apply immediately
  try {
    if (typeof document !== "undefined") {
      document.body.classList.add("dark", "quarry-theme");
    }
  } catch (err) {
    console.error("Failed to add theme classes before render:", err);
  }
  createRoot(container).render(<App />);
}
