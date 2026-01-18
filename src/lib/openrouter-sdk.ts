// Minimal OpenRouter SDK stub for the VS Code extension build.
// This avoids bundling the real SDK while keeping type compatibility.

export class OpenRouter {
  constructor(_opts: any) {
    // noop
  }

  chat = {
    send: async (_payload: any) => {
      throw new Error("OpenRouter SDK is not available in the VS Code extension environment");
    },
  };
}
