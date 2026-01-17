// Mock preferences actions
export async function getPreferences(...args: any[]) {
  return { preferences: {} };
}

export async function updatePreferences(...args: any[]) {
  return { success: false };
}
