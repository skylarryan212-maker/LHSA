// Mock app actions for VS Code extension
export type PlanType = "free" | "pro" | "premium";

export async function getUserPlan(...args: any[]): Promise<PlanType> {
  return "free";
}

export async function updateUserPlan(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}
