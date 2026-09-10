import Link from "next/link";
import type { ReactNode } from "react";

export function ButtonLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-13 w-full items-center justify-center gap-5 rounded-xl bg-brand px-6 py-4 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark sm:w-auto">
      {children}<span aria-hidden="true">↗</span>
    </Link>
  );
}
