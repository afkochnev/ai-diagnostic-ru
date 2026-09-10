import { redirect } from "next/navigation";
import { defaultLocale, localePath } from "@/i18n/config";

export default function RootPage() {
  redirect(localePath(defaultLocale));
}
