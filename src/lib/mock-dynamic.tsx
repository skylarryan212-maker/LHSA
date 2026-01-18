// Mock Next.js dynamic import for VS Code extension
import React from "react";

export default function dynamic(loader: any, options?: any) {
  const Lazy = React.lazy(async () => {
    const resolved = await Promise.resolve().then(() => loader());
    if (resolved && typeof resolved === "object" && "default" in resolved) {
      return resolved;
    }
    return { default: resolved };
  });

  const Loading = options?.loading;
  const fallback = Loading ? React.createElement(Loading) : null;

  return function DynamicWrapper(props: any) {
    return (
      <React.Suspense fallback={fallback}>
        <Lazy {...props} />
      </React.Suspense>
    );
  };
}
