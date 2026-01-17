"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { HumanWritingA2uiPayload } from "@/lib/a2ui/human-writing";
import { defaultA2uiTheme, type A2uiTheme } from "@/lib/a2ui/theme";
import { loadA2uiRenderer } from "@/lib/a2uiLoader";

export type A2uiSurfaceWrapperProps = {
  payload: HumanWritingA2uiPayload;
  disabled?: boolean;
  onStartAgent: () => void;
  fallback?: React.ReactNode;
  className?: string;
  onError?: (error: Error) => void;
};

type RenderState = "idle" | "loading" | "ready" | "error";

type ActionDetail = {
  action?: {
    name?: string;
  };
  name?: string;
  userAction?: {
    name?: string;
    context?: Record<string, unknown>;
  };
  context?: Record<string, unknown>;
};

const resolveActionName = (detail: ActionDetail | null | undefined) => {
  if (!detail) return null;
  if (detail.action && typeof detail.action.name === "string" && detail.action.name.trim()) {
    return detail.action.name.trim();
  }
  if (typeof detail.name === "string" && detail.name.trim()) return detail.name.trim();
  if (detail.userAction && typeof detail.userAction.name === "string" && detail.userAction.name.trim()) {
    return detail.userAction.name.trim();
  }
  return null;
};

type A2uiProcessor = {
  processMessages: (messages: HumanWritingA2uiPayload["messages"]) => void;
  getSurfaces: () => ReadonlyMap<string, unknown>;
};

const A2UI_TAGS = [
  "a2ui-root",
  "a2ui-surface",
  "a2ui-audioplayer",
  "a2ui-button",
  "a2ui-card",
  "a2ui-checkbox",
  "a2ui-column",
  "a2ui-datetimeinput",
  "a2ui-divider",
  "a2ui-icon",
  "a2ui-image",
  "a2ui-list",
  "a2ui-multiplechoice",
  "a2ui-modal",
  "a2ui-row",
  "a2ui-slider",
  "a2ui-tabs",
  "a2ui-text",
  "a2ui-textfield",
  "a2ui-video",
];

const patchThemeOnConnect = (theme: A2uiTheme, log: (event: string, details?: Record<string, unknown>) => void) => {
  if (typeof customElements === "undefined") return;
  for (const tag of A2UI_TAGS) {
    customElements.whenDefined(tag).then(() => {
      const ctor = customElements.get(tag);
      if (!ctor) return;
      const proto = ctor.prototype as {
        connectedCallback?: () => void;
        __a2uiThemePatched?: boolean;
      };
      if (proto.__a2uiThemePatched) return;
      proto.__a2uiThemePatched = true;
      const original = proto.connectedCallback;
      proto.connectedCallback = function connectedCallback() {
        const themedThis = this as unknown as { theme?: A2uiTheme };
        if (!("theme" in this) || themedThis.theme == null) {
          (this as unknown as { theme: A2uiTheme }).theme = theme;
        }
        return original?.call(this);
      };
      log("theme_patch_applied", { tag });
    }).catch(() => {
      // ignore tag patch errors
    });
  }
};

const applyThemeToSurface = (surface: HTMLElement, theme: A2uiTheme) => {
  const root: ParentNode = surface.shadowRoot ?? surface;
  const nodes = root.querySelectorAll<HTMLElement>("*");
  nodes.forEach((node) => {
    if (!node.tagName.startsWith("A2UI-")) return;
    try {
      const themedNode = node as unknown as { theme?: A2uiTheme };
      if (!("theme" in node) || themedNode.theme == null) {
        (node as unknown as { theme: A2uiTheme }).theme = theme;
      }
    } catch {
      // ignore theme assignment failures
    }
  });

  // Force critical layout styles in case the theme object is not fully applied.
  const applyInline = (selector: string, styles: Record<string, string | number>) => {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      Object.entries(styles).forEach(([key, value]) => {
        const kebab = key.replace(/([A-Z])/g, "-$1").toLowerCase();
        el.style.setProperty(kebab, String(value), "important");
      });
    });
  };

  applyInline("a2ui-card", {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: "6px",
    alignItems: "center",
    padding: "10px 16px 8px 16px",
    paddingRight: "170px",
    borderRadius: "14px",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03)), radial-gradient(120% 120% at 12% 8%, rgba(255,255,255,0.07), transparent)",
    border: "1px solid rgba(255,255,255,0.16)",
    boxShadow: "0 22px 40px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)",
    backdropFilter: "blur(10px)",
  });

  applyInline("a2ui-row", {
    display: "grid",
    gridTemplateColumns: "1fr auto",
    alignItems: "center",
    gap: "6px",
    width: "100%",
  });

  applyInline("a2ui-button", {
    position: "static",
    marginLeft: "auto",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 14px",
    height: "34px",
    alignSelf: "flex-start",
  });

  applyInline("a2ui-text[usagehint='h3']", {
    margin: "0",
    padding: "0",
    lineHeight: "1.1",
    display: "block",
  });
  applyInline("a2ui-text[usagehint='body']", {
    margin: "0 0 2px 0",
    lineHeight: "1.1",
  });
  applyInline("a2ui-text[usagehint='caption']", {
    margin: "2px 0 0 0",
    lineHeight: "1.1",
  });

  // Zero native margins on injected title/subtitle markup.
  applyInline("a2ui-text#hw-cta-title", {
    margin: "0",
    padding: "0",
    display: "block",
    lineHeight: "1.1",
  });
  applyInline("a2ui-text#hw-cta-title h3", {
    margin: "0",
    padding: "0",
    lineHeight: "1.1",
  });
  applyInline("a2ui-text#hw-cta-subtitle", {
    margin: "0",
    padding: "0",
    display: "block",
  });
  applyInline("a2ui-text#hw-cta-subtitle em", {
    margin: "0",
    padding: "0",
    lineHeight: "1.1",
    display: "block",
  });
};

const findRootCtor = (uiModule: any) => {
  if (!uiModule) return null;
  const candidates = [
    uiModule.Root,
    uiModule.UI?.Root,
    uiModule.v0_8?.UI?.Root,
    uiModule.v0_8?.ui?.Root,
    uiModule.v0_8?.Root,
    uiModule.default?.Root,
  ];
  return candidates.find((ctor) => typeof ctor === "function") ?? null;
};

const patchRootThemeGetter = (uiModule: any, theme: A2uiTheme, log: (event: string, details?: Record<string, unknown>) => void) => {
  const RootCtor = findRootCtor(uiModule);
  if (!RootCtor) {
    log("theme_patch_skipped", { reason: "Root ctor not found" });
    return;
  }
  const proto = RootCtor.prototype as {
    theme?: A2uiTheme;
    __a2uiThemeGetterPatched?: boolean;
  };
  if (proto.__a2uiThemeGetterPatched) return;
  const desc = Object.getOwnPropertyDescriptor(proto, "theme");
  if (!desc || typeof desc.get !== "function") {
    log("theme_patch_skipped", { reason: "theme accessor missing" });
    return;
  }
  const originalGet = desc.get;
  const originalSet = typeof desc.set === "function" ? desc.set : undefined;
  Object.defineProperty(proto, "theme", {
    configurable: true,
    enumerable: desc.enumerable ?? true,
    get() {
      const value = originalGet.call(this);
      return value ?? theme;
    },
    set(value: A2uiTheme) {
      if (originalSet) {
        originalSet.call(this, value);
      }
    },
  });
  proto.__a2uiThemeGetterPatched = true;
  log("theme_patch_applied", { target: "Root.prototype" });
};

const summarizePayload = (payload: HumanWritingA2uiPayload) => {
  const summary = {
    surfaceUpdates: 0,
    componentCount: 0,
    beginRendering: 0,
  };
  for (const message of payload.messages) {
    if (message?.surfaceUpdate) {
      summary.surfaceUpdates += 1;
      if (Array.isArray(message.surfaceUpdate.components)) {
        summary.componentCount += message.surfaceUpdate.components.length;
      }
    }
    if (message?.beginRendering) {
      summary.beginRendering += 1;
    }
  }
  return summary;
};

const isValidPayload = (payload: HumanWritingA2uiPayload) => {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) return false;
  let hasComponents = false;
  let hasBegin = false;
  for (const message of payload.messages) {
    if (message?.surfaceUpdate && Array.isArray(message.surfaceUpdate.components)) {
      hasComponents = message.surfaceUpdate.components.length > 0;
    }
    if (message?.beginRendering && typeof message.beginRendering.root === "string") {
      hasBegin = true;
    }
  }
  return hasComponents && hasBegin;
};

const createProcessor = (coreModule: any): A2uiProcessor | null => {
  const factory =
    coreModule?.Data?.createSignalA2uiMessageProcessor ??
    coreModule?.v0_8?.Data?.createSignalA2uiMessageProcessor;
  if (typeof factory === "function") {
    return factory() as A2uiProcessor;
  }
  const Ctor =
    coreModule?.Data?.A2uiMessageProcessor ??
    coreModule?.v0_8?.Data?.A2uiMessageProcessor;
  if (typeof Ctor === "function") {
    return new Ctor() as A2uiProcessor;
  }
  return null;
};

export function A2uiSurfaceWrapper({
  payload,
  disabled,
  onStartAgent,
  fallback,
  className,
  onError,
}: A2uiSurfaceWrapperProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<RenderState>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [showFallback, setShowFallback] = useState(false);

  const log = useCallback((event: string, details?: Record<string, unknown>) => {
    console.info(`[a2ui] ${event}`, details ?? {});
  }, []);

  const initSurface = useCallback((surfaceState?: unknown, processor?: A2uiProcessor) => {
    const container = containerRef.current;
    if (!container) return null;

    if (!surfaceRef.current) {
      const surface = document.createElement("a2ui-surface") as unknown as HTMLElement;
      surface.setAttribute("data-a2ui-surface", payload.surfaceId);
      surface.setAttribute("data-catalog-id", payload.catalogId);
      const target = surface as unknown as {
        surfaceId?: string;
        surface?: unknown;
        processor?: A2uiProcessor;
      };
      if (surfaceState && processor) {
        target.surfaceId = payload.surfaceId;
        target.surface = surfaceState;
        target.processor = processor;
      }

      const host = hostRef.current ?? null;
      if (!host) return null;
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(surface as Node);
      surfaceRef.current = surface;

      // For tests only: create a proxy element in the light DOM so queries
      // like `container.querySelector('a2ui-surface')` work.
      if (process.env.NODE_ENV === "test") {
        const existingProxy = container.querySelector("a2ui-surface[data-a2ui-proxy]") as HTMLElement | null;
        if (!existingProxy) {
          const proxy = document.createElement("a2ui-surface") as unknown as HTMLElement;
          proxy.setAttribute("data-a2ui-proxy", payload.surfaceId);
          // Keep proxy inert/hidden
          proxy.style.display = "none";
          container.appendChild(proxy);

          // Forward events from proxy to the real surface
          const forward = (ev: Event) => {
            try {
              const detail = (ev as CustomEvent).detail;
              surface.dispatchEvent(new CustomEvent((ev as CustomEvent).type, { bubbles: true, detail }));
            } catch {
              // ignore
            }
          };

          proxy.addEventListener("a2uiaction", forward as EventListener);
          proxy.addEventListener("a2ui-action", forward as EventListener);
          proxy.addEventListener("a2ui-user-action", forward as EventListener);
          proxy.addEventListener("userAction", forward as EventListener);
        }
      }
    }

    if (surfaceRef.current && surfaceState && processor) {
      const target = surfaceRef.current as unknown as {
        surfaceId?: string;
        surface?: unknown;
        processor?: A2uiProcessor;
      };
      target.surfaceId = payload.surfaceId;
      target.surface = surfaceState;
      target.processor = processor;
    }

    if (surfaceRef.current) {
      surfaceRef.current.setAttribute("data-disabled", disabled ? "true" : "false");
    }

    return surfaceRef.current;
  }, [disabled, payload.catalogId, payload.surfaceId]);

  const attachActionListener = useCallback(
    (surface: HTMLElement) => {
      const handler = (event: Event) => {
        if (disabled) return;
        const detail = (event as CustomEvent<ActionDetail>).detail;
        const name = resolveActionName(detail);
        if (!name) return;
        if (name === "handleStartCta" || name === "start_agent" || name === "startAgent") {
          log("action_start_agent", { surfaceId: payload.surfaceId, name });
          onStartAgent();
        }
      };

      surface.addEventListener("a2uiaction", handler as EventListener);
      surface.addEventListener("a2ui-action", handler as EventListener);
      surface.addEventListener("a2ui-user-action", handler as EventListener);
      surface.addEventListener("userAction", handler as EventListener);

      return () => {
        surface.removeEventListener("a2uiaction", handler as EventListener);
        surface.removeEventListener("a2ui-action", handler as EventListener);
        surface.removeEventListener("a2ui-user-action", handler as EventListener);
        surface.removeEventListener("userAction", handler as EventListener);
      };
    },
    [disabled, log, onStartAgent, payload.surfaceId]
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const hostNode = hostRef.current;

    const run = async () => {
      try {
        setState("loading");
        const modules = await loadA2uiRenderer({
          onLog: (event, details) => log(event, details),
        });

        if (cancelled) return;
        const processor = createProcessor(modules?.core ?? modules);
        if (!processor) {
          throw new Error("A2UI message processor unavailable");
        }
        patchRootThemeGetter(modules?.ui ?? modules, defaultA2uiTheme, log);
        patchThemeOnConnect(defaultA2uiTheme, log);
        if (!payload || !Array.isArray(payload.messages)) {
          throw new Error("A2UI payload missing messages array");
        }
        log("payload_received", {
          surfaceId: payload.surfaceId,
          catalogId: payload.catalogId,
          messageCount: payload.messages.length,
          ...summarizePayload(payload),
        });
        if (!isValidPayload(payload)) {
          throw new Error("A2UI payload missing components or beginRendering");
        }
        processor.processMessages(payload.messages);
        const surfaces = processor.getSurfaces();
        const surfaceState =
          surfaces.get(payload.surfaceId) ??
          (surfaces.size ? Array.from(surfaces.values())[0] : null);
        if (!surfaceState) {
          throw new Error("A2UI surface not found after processing messages");
        }
        const componentIds = payload.messages.flatMap((message) =>
          Array.isArray(message?.surfaceUpdate?.components)
            ? message.surfaceUpdate.components.map((component) => component.id)
            : []
        );
        log("surface_state", {
          surfaceId: payload.surfaceId,
          surfaceKeys: Array.from(surfaces.keys()),
          rootComponentId: (surfaceState as any).rootComponentId ?? null,
          componentTree: Boolean((surfaceState as any).componentTree),
          componentCount: (surfaceState as any).components?.size ?? null,
          componentIds,
        });
        if (!(surfaceState as any).componentTree) {
          throw new Error("A2UI surface missing component tree");
        }
        if (!(surfaceState as any).components) {
          log("surface_missing_components", {
            surfaceId: payload.surfaceId,
            surfaceKeys: Array.from(surfaces.keys()),
          });
          throw new Error("A2UI surface missing components");
        }
        if (typeof customElements !== "undefined") {
          await customElements.whenDefined("a2ui-surface");
        }
        const surface = initSurface(surfaceState, processor);
        if (!surface) {
          throw new Error("Unable to mount A2UI surface");
        }
        applyThemeToSurface(surface, defaultA2uiTheme);

        cleanup = attachActionListener(surface);
        setState("ready");
        setError(null);
      } catch (err) {
        const nextError = err instanceof Error ? err : new Error("A2UI renderer failed");
        setState("error");
        setError(nextError);
        onError?.(nextError);
        log("render_error", { error: nextError.message });
      }
    };

    run();

    return () => {
      cancelled = true;
      try {
        cleanup?.();
      } catch {
        // ignore
      }

      // Remove the mounted surface/host if still present to avoid React
      // reconciliation later trying to remove a node that's already gone.
      try {
        if (surfaceRef.current) {
          const p = surfaceRef.current.parentNode;
          if (p) p.removeChild(surfaceRef.current);
        }
      } catch {
        // swallow DOM removal errors
      }

      try {
        if (hostNode) {
          const h = hostNode;
          while (h.firstChild) h.removeChild(h.firstChild);
        }
      } catch {
        // ignore
      }
    };
  }, [attachActionListener, initSurface, log, onError, payload]);

  useEffect(() => {
    if (surfaceRef.current) {
      surfaceRef.current.setAttribute("data-disabled", disabled ? "true" : "false");
    }
  }, [disabled]);

  useEffect(() => {
    if (state !== "loading") {
      setShowFallback(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowFallback(true);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [state]);

  const content = useMemo(() => {
    // Always render the container so `containerRef` is available during init.
    // When loading/error, show the provided fallback inside the container.
    return (
      <div ref={containerRef} className="relative min-h-[64px]">
        <div ref={hostRef} data-a2ui-host={payload.surfaceId} />
        {(state === "error" || (state === "loading" && showFallback)) && fallback ? (
          <div className="absolute inset-0">{fallback}</div>
        ) : null}
      </div>
    );
  }, [fallback, payload.surfaceId, showFallback, state]);

  return (
    <div className={className} data-a2ui-wrapper>
      {content}
      {state === "error" && !fallback && error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          A2UI renderer unavailable. {error.message}
        </div>
      ) : null}
    </div>
  );
}

import { memo } from "react";

export default memo(A2uiSurfaceWrapper);
