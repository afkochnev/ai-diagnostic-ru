import {AdminEntityPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({params,searchParams}:{params:Promise<{accountId:string}>;searchParams:AdminSearch}){const p=await params,s=await searchParams;return <AdminEntityPage section="accounts" id={p.accountId} returnTo={typeof s.returnTo==="string"?s.returnTo:undefined}/>;}
