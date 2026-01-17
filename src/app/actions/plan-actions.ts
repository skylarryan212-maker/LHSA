// Mock app actions for VS Code extension
// Align PlanType with usage limits used across the app
export type PlanType = "free" | "plus" | "max";

export async function getUserPlan(...args: any[]): Promise<PlanType> {
  return "free";
}

export async function updateUserPlan(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}
