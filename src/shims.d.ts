declare module "@/lib/supabase/browser-client" {
  const supabaseClient: any;
  export default supabaseClient;
}

declare module "@lib/supabase/browser-client" {
  const supabaseClient: any;
  export default supabaseClient;
}

declare module "@openrouter/sdk" {
  export const OpenRouter: any;
}

declare module "openai/resources/chat/completions" {
  export type ChatCompletionMessageParam = any;
}

declare module "@supabase/supabase-js" {
  export type SupabaseClient<T = any> = any;
  export const createClient: any;
}
