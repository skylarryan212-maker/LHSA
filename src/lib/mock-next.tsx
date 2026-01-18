// Mock Next.js hooks for VS Code extension environment
import { useState, useMemo } from "react";

export function useRouter() {
  return {
    push: (path: string) => console.log("Navigate to:", path),
    replace: (path: string, _opts?: any) => console.log("Replace with:", path),
    refresh: () => console.log("Refresh route"),
    back: () => console.log("Navigate back"),
    pathname: "/",
    query: {},
  };
}

export function useSearchParams() {
  const [params] = useState(new URLSearchParams());
  return params;
}

export function usePathname() {
  return "/";
}
