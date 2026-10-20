import {AdminOverview} from "@/features/admin/console-pages";
import {requireAdmin} from "@/server/auth/admin";
export default async function Page(){await requireAdmin();return <AdminOverview/>;}
