declare module "pako" {
  const pako: any;
  export default pako;
}

declare module "jszip" {
  const JSZip: any;
  export default JSZip;
}

declare module "fast-xml-parser" {
  export const XMLParser: any;
}

declare module "music-metadata" {
  export const parseBuffer: any;
}

declare module "openai/resources/chat/completions" {
  export type ChatCompletionMessageParam = any;
}

declare module "@openrouter/sdk" {
  export const OpenRouter: any;
}

declare module "@supabase/supabase-js" {
  export type SupabaseClient<T = any> = any;
  export const createClient: any;
}

declare module "@/lib/supabase/browser-client" {
  const supabaseClient: any;
  export default supabaseClient;
}

declare module "@lib/supabase/browser-client" {
  const supabaseClient: any;
  export default supabaseClient;
}

declare module "html-to-text" {
  export const htmlToText: any;
  export const convert: any;
}

declare module "pdfjs-dist/legacy/build/pdf" {
  const pdfjs: any;
  export default pdfjs;
}

declare module "pdfjs-dist/build/pdf" {
  const pdfjs: any;
  export default pdfjs;
}

declare module "yaml" {
  const yaml: any;
  export default yaml;
}

declare module "@iarna/toml" {
  const toml: any;
  export default toml;
}

declare module "json5" {
  const json5: any;
  export default json5;
}

declare module "js-tiktoken" {
  export const get_encoding: any;
  export const encodingForModel: any;
}

declare module "openai" {
  const OpenAI: any;
  export default OpenAI;
  export type ClientOptions = any;
}

declare module "next/server" {
  export const NextResponse: any;
  export const NextRequest: any;
}

declare module "zod" {
  export const z: any;
  export namespace z {
    type infer<T> = any;
  }
}
