// Mock app actions for VS Code extension
export async function sendChatMessage(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function createConversation(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function deleteConversation(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function updateConversationTitle(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function loadOlderMessages(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

// Backwards-compatible aliases used by imported components
export const deleteConversationAction = deleteConversation;
export async function moveConversationToProjectAction(...args: any[]) {
  // Not implemented in extension; provide a stub that resolves to a no-op result
  return { success: false, error: "moveConversationToProject not implemented" };
}
export const renameConversationAction = updateConversationTitle;
