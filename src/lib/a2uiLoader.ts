type LoadA2uiOptions = {
  src?: string;
  styleHref?: string | null;
  timeoutMs?: number;
  cdnFallbackSrc?: string;
  coreSrc?: string;
  onLog?: (event: string, details?: Record<string, unknown>) => void;
};

const DEFAULT_A2UI_SRC = "/a2ui/0.8/ui.bundle.js";
const DEFAULT_A2UI_CSS: string | null = null;
const DEFAULT_A2UI_CORE_SRC = "/a2ui/0.8/core.bundle.js";

export type A2uiRendererModules = {
  ui?: unknown;
  core?: unknown;
};

let loadPromise: Promise<A2uiRendererModules> | null = null;

const log = (options: LoadA2uiOptions | undefined, event: string, details?: Record<string, unknown>) => {
  if (options?.onLog) {
    options.onLog(event, details);
    return;
  }
  if (typeof window !== "undefined") {
    console.info(`[a2ui] ${event}`, details ?? {});
  }
};

const ensureStylesheet = (href: string) => {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[data-a2ui-style="true"][href="${href}"]`);
  if (existing) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.a2uiStyle = "true";
  document.head.appendChild(link);
};

const importModule = async (src: string, timeoutMs: number) => {
  if (typeof window === "undefined") {
    throw new Error("A2UI renderer can only be loaded in the browser");
  }
  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error(`Timed out loading A2UI renderer from ${src}`)), timeoutMs);
  });
  const mod = await Promise.race([
    import(/* webpackIgnore: true */ src),
    timeout,
  ]);
  return mod;
};

export const loadA2uiRenderer = (options?: LoadA2uiOptions): Promise<A2uiRendererModules> => {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("A2UI renderer can only be loaded in the browser"));
  }

  if (loadPromise) {
    return loadPromise;
  }

  const src = options?.src ?? DEFAULT_A2UI_SRC;
  const styleHref = options?.styleHref ?? DEFAULT_A2UI_CSS;
  const timeoutMs = options?.timeoutMs ?? 12_000;
  const fallbackSrc = options?.cdnFallbackSrc;
  const coreSrc = options?.coreSrc ?? DEFAULT_A2UI_CORE_SRC;

  loadPromise = (async (): Promise<A2uiRendererModules> => {
    if (styleHref) {
      ensureStylesheet(styleHref);
    }

    try {
      log(options, "script_load_start", { src });
      const ui = await importModule(src, timeoutMs);
      log(options, "script_load_success", { src });
      const core = coreSrc ? await importModule(coreSrc, timeoutMs) : undefined;
      return { ui, core };
    } catch (primaryError) {
      log(options, "script_load_failure", { src, error: String(primaryError) });
      if (fallbackSrc) {
        log(options, "script_load_fallback_start", { src: fallbackSrc });
        const ui = await importModule(fallbackSrc, timeoutMs);
        log(options, "script_load_fallback_success", { src: fallbackSrc });
        const core = coreSrc ? await importModule(coreSrc, timeoutMs) : undefined;
        return { ui, core };
      }
      throw primaryError;
    }
  })();

  return loadPromise;
};

export type { LoadA2uiOptions };
