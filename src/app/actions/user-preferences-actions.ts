// Mock app actions for VS Code extension
export async function getUserPreferences(...args: any[]) {
  return { preferences: {} };
}

export async function updateUserPreferences(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension", message: "Not implemented" };
}

// Compatibility exports expected by chat shell
export async function getContextModeGlobalPreference(..._args: any[]) {
  return "simple" as const;
}

export async function saveContextModeGlobalPreference(..._args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension", message: "Not implemented" };
}

export async function getAllowDataForImprovement(..._args: any[]) {
  return false;
}

export async function saveAllowDataForImprovement(..._args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension", message: "Not implemented" };
}

export async function getPersonalizationPreferences(..._args: any[]) {
  return {
    customInstructions: "",
    referenceSavedMemories: true,
    referenceChatHistory: true,
    allowSavingMemory: true,
    baseStyle: "Professional",
  };
}

export async function savePersonalizationPreferences(..._args: any[]) {
  return { success: true, message: "Saved" };
}
