// Lightweight shim to replace @supabase/ssr in the VS Code extension environment.
// Returns a minimal stub that satisfies imports used in the webview.
export function createBrowserClient<Database = any>(
  _url: string,
  _anonKey: string,
  _opts?: any
) {
  const createQueryStub = (result: { data: any; error: any } = { data: [], error: null }) => {
    const stub: any = {
      select: () => stub,
      insert: () => stub,
      update: () => stub,
      delete: () => stub,
      upsert: () => stub,
      eq: () => stub,
      neq: () => stub,
      in: () => stub,
      ilike: () => stub,
      or: () => stub,
      order: () => stub,
      limit: () => stub,
      range: () => stub,
      single: () => stub,
      maybeSingle: () => stub,
      then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(result).catch(reject),
      finally: (cb: any) => Promise.resolve(result).finally(cb),
    };
    return stub;
  };

  const channelStub: any = {
    on: () => channelStub,
    subscribe: () => channelStub,
    unsubscribe: () => {},
  };

  // Minimal stub supabase client; real network calls are not used in the extension
  const stub: any = {
    auth: {
      getSession: async () => ({ data: null, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async () => ({ data: null, error: null }),
      signInWithPassword: async () => ({ data: null, error: null }),
      signInWithOtp: async () => ({ data: null, error: null }),
      verifyOtp: async () => ({ data: null, error: null }),
      updateUser: async () => ({ data: null, error: null }),
    },
    from: (_table: string) => createQueryStub(),
    rpc: (_fn: string, _args?: any) => createQueryStub(),
    channel: (_name?: string) => channelStub,
    removeChannel: (_channel: any) => {},
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
