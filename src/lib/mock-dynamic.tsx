// Mock Next.js dynamic import for VS Code extension
import React from "react";

export default function dynamic(loader: any, options?: any) {
  return React.lazy(loader);
}
