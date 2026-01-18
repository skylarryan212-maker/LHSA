// Mock app actions for VS Code extension
export async function getProjects(...args: any[]) {
  return { projects: [] };
}

export async function createProject(name?: string, icon?: string, color?: string): Promise<{
  id: string;
  name: string;
  created_at?: string;
  icon?: string;
  color?: string;
}> {
  return {
    id: `local-${Date.now()}`,
    name: typeof name === "string" && name.trim().length > 0 ? name : "Untitled project",
    created_at: new Date().toISOString(),
    icon,
    color,
  };
}

export async function deleteProject(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function updateProject(...args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

export async function updateProjectIconAction(..._args: any[]) {
  return { success: false, error: "Not implemented in VS Code extension" };
}

// Backwards-compatible aliases
export const deleteProjectAction = deleteProject;
export const renameProjectAction = updateProject;
export const createProjectAction: (...args: any[]) => any = createProject as any;
