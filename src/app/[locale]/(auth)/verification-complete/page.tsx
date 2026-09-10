export const metadata = { title: "Email подтверждён", robots: { index: false, follow: false } };

import { redirect } from "next/navigation";
export default function VerificationCompletePage() { redirect("/ru/company-profile"); }
