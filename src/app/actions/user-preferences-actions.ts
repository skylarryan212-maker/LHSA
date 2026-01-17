// Mock app actions for VS Code extension
export async function getUserPreferences(...args: any[]) {
  return { preferences: {} };
}

export async function updateUserPreferences(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}
