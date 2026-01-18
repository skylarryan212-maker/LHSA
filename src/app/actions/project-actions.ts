// Mock app actions for VS Code extension
export async function getProjects(...args: any[]) {
  return { projects: [] };
}

export async function createProject(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function deleteProject(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function updateProject(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}
