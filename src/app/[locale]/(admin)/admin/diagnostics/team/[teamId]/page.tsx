import {AdminTeamPage} from "@/features/admin/console-pages";
export default async function Page({params}:{params:Promise<{teamId:string}>}){const p=await params;return <AdminTeamPage id={p.teamId}/>;}
