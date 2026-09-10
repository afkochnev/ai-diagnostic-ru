import { redirect } from "next/navigation";
import { signedInDestination } from "@/server/auth/session";
export default async function AccountPage() { redirect(await signedInDestination()); }
