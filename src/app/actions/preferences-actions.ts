// Mock preferences actions
export async function getPreferences(...args: any[]) {
  return { preferences: {} };
}

export async function updatePreferences(...args: any[]) {
  return { success: false, message: "Not implemented" };
}

// Compatibility export for settings modal
export async function updateAccentColorAction(..._args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension", message: "Not implemented" };
}
