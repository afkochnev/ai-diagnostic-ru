import "server-only";
import { redirect } from "next/navigation";
import { AccountAccessError, requireCompanyRead } from "@/server/account/authorization";

export async function requireCompanyRoute(companyId: string, userId: string) {
  try {
    return await requireCompanyRead(companyId, userId);
  } catch (error) {
    if (error instanceof AccountAccessError && error.code === "not_found") redirect("/ru/access-denied");
    throw error;
  }
}
