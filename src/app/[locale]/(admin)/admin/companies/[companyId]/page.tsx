import {AdminEntityPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({params,searchParams}:{params:Promise<{companyId:string}>;searchParams:AdminSearch}){const p=await params,s=await searchParams;return <AdminEntityPage section="companies" id={p.companyId} returnTo={typeof s.returnTo==="string"?s.returnTo:undefined}/>;}
