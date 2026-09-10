import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";
import { Card } from "@/components/ui/card";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <main id="main-content" className="min-h-[70vh] py-12 sm:py-16"><Container><Card className="mx-auto max-w-lg"><h1 className="mb-7 text-3xl font-semibold tracking-tight">{title}</h1>{children}</Card></Container></main>;
}
