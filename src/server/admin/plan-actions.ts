"use server";
import {headers} from "next/headers";
import {revalidatePath} from "next/cache";
import {z} from "zod";
import {requireAdmin} from "@/server/auth/admin";
import {createAuthClient} from "@/server/supabase/server";
import {authConfig} from "@/server/supabase/config";
export type PlanActionState={error?:string;success?:string};
const transition=z.object({account:z.uuid(),target:z.enum(["free","advanced"]),expected:z.enum(["free","advanced"]),reason:z.string().trim().min(3).max(500),confirm:z.literal("on")});
export async function changeAdminPlan(_:PlanActionState,form:FormData):Promise<PlanActionState>{
 await requireAdmin();
 if((await headers()).get("origin")!==authConfig().APP_URL)return {error:"Не удалось подтвердить источник запроса. Обновите страницу."};
 const parsed=transition.safeParse(Object.fromEntries(["account","target","expected","reason","confirm"].map(k=>[k,form.get(k)])));
 if(!parsed.success)return {error:"Укажите тариф, причину от 3 до 500 символов и подтвердите изменение."};
 const {account,target,expected,reason}=parsed.data,client=await createAuthClient();
 // The database independently checks the actor, locks the Account, re-reads its
 // plan, closes the old subscription and writes the new plan and audit atomically.
 const {data,error}=await client.rpc("admin_assign_account_plan",{p_account_id:account,p_target_plan:target,p_expected_plan:expected,p_reason:reason});
 if(error){const message=error.message;return {error:message.includes("admin_plan_changed_refresh")?"Тариф уже изменён. Обновите страницу перед новой операцией.":message.includes("admin_not_found")?"Аккаунт не найден или недоступен.":"Не удалось изменить тариф. Обновите страницу и проверьте права доступа."};}
 const result=z.object({status:z.enum(["changed","unchanged"]),plan:z.enum(["free","advanced"])}).safeParse(data);
 if(!result.success)return {error:"Не удалось подтвердить результат изменения. Обновите страницу."};
 revalidatePath(`/ru/admin/accounts/${account}`);revalidatePath("/ru/admin/accounts");revalidatePath("/ru/admin");
 return {success:result.data.status==="unchanged"?"Выбранный тариф уже действует. Новое изменение не создавалось.":"Тариф изменён. Причина и запись аудита сохранены."};
}
