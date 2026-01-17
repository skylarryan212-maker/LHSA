"use client";

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
};

import { Suspense, useState, useRef, useEffect } from "react";
import css from "./webview.css";
import { createRoot } from "react-dom/client";
import { WelcomeScreen } from "./components/chat/welcome-screen";
import { ChatComposer, type SearchControls } from "./components/chat-composer";
import { Button } from "./components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import { ChatSidebar } from "./components/chat-sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";

const vscodeApi =
  typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;

const DEFAULT_SEARCH_CONTROLS: SearchControls = { sourceLimit: "auto", excerptMode: "auto" };

const CENTERED_COMPOSER_OFFSET = "calc(-52vh + 120px)";

const MODEL_OPTIONS = [
  { label: "Auto", description: "We'll pick the best model" },
  { label: "GPT OSS 20b", description: "Open-weight, low cost" },
  { label: "GPT 5 Nano", description: "Lightweight" },
  { label: "GPT 5 Mini", description: "Fast, lower cost" },
  { label: "Grok 4.1 Fast", description: "Conversational flow" },
  { label: "GPT 5.2", description: "Balanced quality" },
  { label: "GPT 5.2 Pro", description: "Highest quality" },
];

function App() {
  const [currentModel, setCurrentModel] = useState("Auto");
  const [searchControls, setSearchControls] = useState<SearchControls>(DEFAULT_SEARCH_CONTROLS);
  const centeredComposerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.body.classList.add("dark", "quarry-theme");
    return () => {
      document.body.classList.remove("dark", "quarry-theme");
    };
  }, []);

  const shouldUseCenteredComposer = true;
  const emptyStateTransform = "translateY(calc(-5vh + 72px))";
  const emptyStatePaddingTop = "calc(48vh - 180px)";
  const emptyStateJustifyClass = "justify-start";
  const composerDockedPosition = "center" as const;
  const composerLiftPx = 0;
  const composerTransitionEnabled = true;

  const handleSubmit = (message: string, attachments?: any[], searchCtrl?: SearchControls) => {
    console.log("Message submitted:", message, attachments, searchCtrl);
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: "chat-message",
        message,
        attachments,
        searchControls: searchCtrl,
      });
    }
  };

  const sidebarConversations = [
    { id: "1", title: "New chat", timestamp: new Date().toISOString() },
    { id: "2", title: "Design review notes", timestamp: new Date().toISOString() },
    { id: "3", title: "Onboarding plan", timestamp: new Date().toISOString() },
  ];
  const sidebarProjects = [
    { id: "p1", name: "Quarry Demo", metadata: {} },
    { id: "p2", name: "Research", metadata: {} },
  ];
  const projectChats = {
    p1: [{ id: "p1c1", title: "Landing page", timestamp: new Date().toISOString() }],
    p2: [{ id: "p2c1", title: "Notes", timestamp: new Date().toISOString() }],
  };

  const composerInner = (
    <ChatComposer
      onSubmit={handleSubmit}
      placeholder="Ask Quarry..."
      isStreaming={false}
      showAttachmentButton={true}
      searchControls={searchControls}
      onSearchControlsChange={setSearchControls}
      shouldGrowDownward={shouldUseCenteredComposer}
      stackedActions
    />
  );

  return (
    <>
      <style>{css}</style>
      <div className="dark quarry-theme">
        <div className="bg-[#0f0f1a] flex h-[100dvh] max-h-[100dvh] w-full min-w-0 text-foreground dark overflow-hidden overscroll-y-none is-chat-page">
          <ChatSidebar
            isOpen={true}
            onToggle={() => undefined}
            selectedChatId={"1"}
            conversations={sidebarConversations}
            chatgptConversations={[]}
            claudeConversations={[]}
            projects={sidebarProjects}
            projectChats={projectChats}
            onChatSelect={() => undefined}
            onProjectChatSelect={() => undefined}
            onNewChat={() => undefined}
            onNewProject={() => undefined}
            onProjectSelect={() => undefined}
            selectedProjectId={"p1"}
            onSettingsOpen={() => undefined}
            onGeneralSettingsOpen={() => undefined}
            onRefreshChats={() => undefined}
            onRefreshProjects={() => undefined}
          />
          <Suspense fallback={null}>
            <div
              data-main-panel="true"
              className="bg-[#151527] flex flex-1 flex-col w-full min-w-0 min-h-0 overflow-hidden lg:my-2 lg:mr-2 lg:rounded-2xl lg:border border-indigo-400/[0.08] copilot-gradient-bg show-gradient"
            >
              {/* Header bar */}
              <div className="sticky top-0 z-20 flex h-[53px] items-center justify-between border-b border-indigo-400/[0.08] bg-[#151527] px-3 lg:px-6 lg:rounded-t-2xl">
                <div className="flex items-center gap-3 min-w-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-auto gap-1.5 border-0 px-2 text-base font-semibold focus-visible:bg-transparent focus-visible:outline-none focus-visible:ring-0"
                      >
                        {currentModel}
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      sideOffset={8}
                      className="floating-card w-auto min-w-[220px] max-w-[90vw] sm:w-64 space-y-1 py-2"
                    >
                      {MODEL_OPTIONS.map((option) => (
                        <DropdownMenuItem
                          key={option.label}
                          className="items-center gap-3 px-3 py-2"
                          onSelect={() => setCurrentModel(option.label)}
                        >
                          <div className="flex flex-1 flex-col">
                            <span className="font-medium leading-none text-foreground">{option.label}</span>
                            <span className="text-xs text-muted-foreground">{option.description}</span>
                          </div>
                          <span className="flex w-4 justify-end">
                            {currentModel === option.label && <Check className="h-4 w-4 text-muted-foreground" />}
                          </span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex items-center gap-2" />
              </div>

              {/* Welcome Screen */}
              <div className="flex-1 min-w-0 overflow-hidden flex flex-col min-h-0">
                <WelcomeScreen
                  shouldUseCenteredComposer={shouldUseCenteredComposer}
                  emptyStateTransform={emptyStateTransform}
                  emptyStatePaddingTop={emptyStatePaddingTop}
                  emptyStateJustifyClass={emptyStateJustifyClass}
                  centeredComposerRef={centeredComposerRef}
                />
              </div>

              {/* Composer */}
              <div
                className={`bg-transparent px-4 sm:px-6 lg:px-12 py-3 sm:py-4 relative sticky bottom-0 z-30 pb-[max(env(safe-area-inset-bottom),0px)] ${
                  composerTransitionEnabled ? "transition-transform duration-200 ease-out" : ""
                }`}
                style={{
                  ["--composer-drop-offset" as string]: CENTERED_COMPOSER_OFFSET,
                  transform: `translateY(calc(${-Math.max(0, composerLiftPx + 4)}px + ${
                    composerDockedPosition === "center"
                      ? "var(--composer-drop-offset, CENTERED_COMPOSER_OFFSET)"
                      : "0px"
                  }))`,
                }}
              >
                <div className="mx-auto w-full max-w-3xl">{composerInner}</div>
              </div>
            </div>
          </Suspense>
        </div>
      </div>
    </>
  );
}

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
