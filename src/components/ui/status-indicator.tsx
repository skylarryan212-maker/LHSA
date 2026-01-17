"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const statusIndicatorVariants = cva(
  "inline-flex items-center gap-2.5 text-sm font-medium transition-all duration-300",
  {
    variants: {
      variant: {
        shimmer: "",
        pulse: "",
        spinner: "",
        static: "",
      },
      status: {
        active: "",
        done: "text-emerald-400",
        error: "text-rose-400",
      },
    },
    defaultVariants: {
      variant: "shimmer",
      status: "active",
    },
  }
);

export interface StatusIndicatorProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusIndicatorVariants> {
  text: string;
  showIcon?: boolean;
}

function StatusIndicator({
  className,
  variant,
  status,
  text,
  showIcon = true,
  ...props
}: StatusIndicatorProps) {
  return (
    <div
      className={cn(statusIndicatorVariants({ variant, status }), className)}
      {...props}
    >
      {showIcon && (
        <StatusIcon variant={variant} status={status} />
      )}
      <StatusText variant={variant} status={status} text={text} />
    </div>
  );
}

function StatusIcon({
  variant,
  status,
}: {
  variant: StatusIndicatorProps["variant"];
  status: StatusIndicatorProps["status"];
}) {
  if (status === "done") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  }

  if (status === "error") {
    return <XCircle className="h-4 w-4 text-rose-400" />;
  }

  // Active states
  if (variant === "spinner") {
    return <Loader2 className="h-4 w-4 animate-spin text-white/70" />;
  }

  if (variant === "pulse") {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
      </span>
    );
  }

  // Shimmer variant - no icon, just the text effect
  return null;
}

function StatusText({
  variant,
  status,
  text,
}: {
  variant: StatusIndicatorProps["variant"];
  status: StatusIndicatorProps["status"];
  text: string;
}) {
  // Done or error states - static colored text
  if (status === "done") {
    return <span className="text-emerald-400">{text}</span>;
  }

  if (status === "error") {
    return <span className="text-rose-400">{text}</span>;
  }

  // Active shimmer - gradient animated text
  if (variant === "shimmer") {
    return (
      <span className="inline-block bg-[linear-gradient(90deg,rgba(120,126,140,0.9),rgba(255,255,255,0.95),rgba(120,126,140,0.9))] bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_1.4s_linear_infinite]">
        {text}
      </span>
    );
  }

  // Other active variants - white text
  return <span className="text-white/80">{text}</span>;
}

export { StatusIndicator, statusIndicatorVariants };
