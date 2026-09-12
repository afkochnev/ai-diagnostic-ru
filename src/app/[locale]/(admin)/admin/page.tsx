import { AdminShell } from "@/features/admin/admin-shell";
import { requireAdmin } from "@/server/auth/admin";

export default async function AdminEntry() {
  await requireAdmin();
  return <AdminShell />;
}
