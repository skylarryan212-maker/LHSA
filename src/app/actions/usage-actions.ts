// Mock app actions for VS Code extension
export async function getUsageStats(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

// Compatibility export for UI components expecting this helper
export async function getMonthlySpending(..._args: any[]) {
  return 0;
}

export async function getUserTotalSpending(..._args: any[]) {
  return 0;
}
