import {AdminEntityPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({params,searchParams}:{params:Promise<{userId:string}>;searchParams:AdminSearch}){const p=await params,s=await searchParams;return <AdminEntityPage section="users" id={p.userId} returnTo={typeof s.returnTo==="string"?s.returnTo:undefined}/>;}
