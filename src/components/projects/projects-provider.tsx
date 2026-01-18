// @ts-nocheck
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createProjectAction } from "../../app/actions/project-actions.js";
import supabaseClient from "../../lib/supabase/browser-client.js";

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: string;
  icon?: string;
  color?: string;
  description?: string;
  metadata?: Record<string, unknown> | null;
};

type ProjectsContextValue = {
  projects: ProjectSummary[];
  addProject: (name: string, icon?: string, color?: string) => Promise<ProjectSummary>;
  refreshProjects: () => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

const initialProjects: ProjectSummary[] = [];

export function ProjectsProvider({
  children,
  initialProjects: initialProjectsProp = initialProjects,
  userId,
}: {
  children: React.ReactNode;
  initialProjects?: ProjectSummary[];
  userId: string;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjectsProp);

  const refreshProjects = useCallback(async () => {
    try {
      if (!userId) return;
      const { data, error } = await supabaseClient
        .from("projects")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Failed to load projects (client):", error);
        return;
      }

      const rows = data ?? [];
      const mapped = rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at ?? new Date().toISOString(),
        icon: r.icon ?? "file",
        color: r.color ?? "white",
        description: r.description ?? "",
        metadata: r.metadata ?? null,
      } as ProjectSummary));

      setProjects(mapped);
    } catch (err) {
      console.warn("projects-provider refresh error", err);
    }
  }, [userId]);

  // Hydrate on mount
  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  // Realtime updates for projects table (INSERT/UPDATE/DELETE)
  useEffect(() => {
    if (!userId) return;
    const channel = supabaseClient
      .channel("public:projects")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects", filter: `user_id=eq.${userId}` },
        (payload) => {
          const newRow = payload.new as any | null;
          const oldRow = payload.old as any | null;

          if (payload.eventType === "INSERT" && newRow) {
            setProjects((prev) => [
              {
                id: newRow.id,
                name: newRow.name,
                createdAt: newRow.created_at ?? new Date().toISOString(),
                icon: newRow.icon ?? "file",
                color: newRow.color ?? "white",
                description: newRow.description ?? "",
                metadata: newRow.metadata ?? null,
              },
              ...prev.filter((p) => p.id !== newRow.id),
            ]);
            return;
          }

          if (payload.eventType === "UPDATE" && newRow) {
            setProjects((prev) =>
              prev.map((p) =>
                p.id === newRow.id
                  ? {
                      id: newRow.id,
                      name: newRow.name,
                      createdAt: newRow.created_at ?? p.createdAt,
                      icon: newRow.icon ?? p.icon,
                      color: newRow.color ?? p.color,
                      description: newRow.description ?? p.description,
                      metadata: newRow.metadata ?? p.metadata ?? null,
                    }
                  : p
              )
            );
            return;
          }

          if (payload.eventType === "DELETE" && oldRow) {
            setProjects((prev) => prev.filter((p) => p.id !== oldRow.id));
            return;
          }
        }
      )
      .subscribe();

    return () => {
      try { channel.unsubscribe(); } catch {}
    };
  }, [userId]);

  // Refresh on tab focus/visibility gain to recover from missed events
  useEffect(() => {
    const onFocus = () => refreshProjects();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshProjects();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshProjects]);

  const addProject = useCallback(async (name: string, icon?: string, color?: string): Promise<ProjectSummary> => {
    const fallbackId = `local-${Date.now()}`;
    const newProject: any = {};
    newProject.id = fallbackId;
    newProject.name = name;
    newProject.createdAt = new Date().toISOString();
    newProject.icon = icon ?? "file";
    newProject.color = color ?? "white";
    newProject.description = "Newly created project";
    newProject.metadata = null;

    try {
      await (createProjectAction as any)(name, icon, color);
    } catch (err) {
      console.warn("createProjectAction failed in extension:", err);
    }

    setProjects((prev) => [newProject, ...prev]);
    return newProject as ProjectSummary;
  }, []);

  const value = useMemo(
    () => ({
      projects,
      addProject,
      refreshProjects,
    }),
    [addProject, projects, refreshProjects]
  );

  return (
    <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
  );
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjects must be used within a ProjectsProvider");
  }
  return context;
}
