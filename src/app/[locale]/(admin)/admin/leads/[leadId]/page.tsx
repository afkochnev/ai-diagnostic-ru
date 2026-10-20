import {AdminEntityPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({params,searchParams}:{params:Promise<{leadId:string}>;searchParams:AdminSearch}){const p=await params,s=await searchParams;return <AdminEntityPage section="leads" id={p.leadId} returnTo={typeof s.returnTo==="string"?s.returnTo:undefined}/>;}
