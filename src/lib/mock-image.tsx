// Mock Next.js Image component for VS Code extension
import React from "react";

export default function Image({ src, alt, ...props }: any) {
  return <img src={src} alt={alt} {...props} />;
}
