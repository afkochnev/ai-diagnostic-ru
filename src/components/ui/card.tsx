import type { ReactNode } from "react";

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={`rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8 ${className}`}>{children}</div>;
}
