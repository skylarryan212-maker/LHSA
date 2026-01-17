import Link from "next/link";
import { ArrowLeft } from "lucide-react";

type BackToAgentsLinkProps = {
  className?: string;
};

export function BackToAgentsLink({ className }: BackToAgentsLinkProps) {
  const baseClassName =
    "fixed left-4 top-4 z-30 group inline-flex items-center gap-2 text-sm font-normal text-slate-300 transition hover:text-white font-sans";
  const combinedClassName = className ? `${baseClassName} ${className}` : baseClassName;

  return (
    <Link href="/agents" className={combinedClassName}>
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      Back to agents
    </Link>
  );
}
