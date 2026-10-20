import type {ReactNode} from "react";
import {requireAdmin} from "@/server/auth/admin";
import {AdminNavigation} from "@/features/admin/console-ui";
export default async function AdminLayout({children}:{children:ReactNode}){await requireAdmin();return <><AdminNavigation/>{children}</>;}
