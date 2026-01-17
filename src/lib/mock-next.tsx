// Mock Next.js hooks for VS Code extension environment
import { useState, useMemo } from "react";

export function useRouter() {
  return {
    push: (path: string) => console.log("Navigate to:", path),
    replace: (path: string) => console.log("Replace with:", path),
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
