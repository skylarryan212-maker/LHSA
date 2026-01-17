const pickEnv = (...keys: Array<string | undefined>) => {
  for (const key of keys) {
    if (!key) continue;
    const value = process.env[key];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
};

type OpenRouterAttribution = {
  httpReferer?: string;
  xTitle?: string;
  headers?: Record<string, string>;
};

export const buildOpenRouterAttribution = (): OpenRouterAttribution | undefined => {
  const httpReferer = pickEnv(
    "OPENROUTER_HTTP_REFERER",
    "OPENROUTER_SITE_URL",
    "NEXT_PUBLIC_SITE_URL"
  );
  const xTitle = pickEnv(
    "OPENROUTER_APP_TITLE",
    "NEXT_PUBLIC_SITE_NAME",
    "NEXT_PUBLIC_APP_NAME"
  );

  if (!httpReferer && !xTitle) return undefined;

  const headers: Record<string, string> = {};
  if (httpReferer) headers["HTTP-Referer"] = httpReferer;
  if (xTitle) headers["X-Title"] = xTitle;

  return {
    httpReferer,
    xTitle,
    headers: Object.keys(headers).length ? headers : undefined,
  };
};
