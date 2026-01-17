export const FEATURED_AGENTS: Array<{ id: string; name: string; icon?: any; description?: string }> = [];

export function getFeaturedAgentById(id?: string | null) {
  if (!id) return null;
  return FEATURED_AGENTS.find((a) => a.id === id) ?? null;
}
