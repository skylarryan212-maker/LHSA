// Lightweight shim to replace @supabase/ssr in the VS Code extension environment.
// Returns a minimal stub that satisfies imports used in the webview.
export function createBrowserClient<Database = any>(
  _url: string,
  _anonKey: string,
  _opts?: any
) {
  // Minimal stub supabase client — real network calls are not used in the extension
  const stub: any = {
    auth: {
      getSession: async () => ({ data: null }),
      signOut: async () => ({ error: null }),
    },
    from: (_table: string) => ({ select: async () => ({ data: null, error: null }) }),
  };
  return stub;
}

export function createServerClient<Database = any>(
  _url: string,
  _anonKey: string,
  _opts?: any
) {
  return createBrowserClient<Database>(_url, _anonKey, _opts);
}

export default createBrowserClient;
