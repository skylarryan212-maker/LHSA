// Mock Next.js Link component for VS Code extension
import React from "react";

export default function Link({ href, children, ...props }: any) {
  return (
    <a href={href} {...props} onClick={(e) => { e.preventDefault(); console.log("Navigate to:", href); }}>
      {children}
    </a>
  );
}
