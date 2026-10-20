import {AdminMetricsPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({searchParams}:{searchParams:AdminSearch}){return <AdminMetricsPage searchParams={searchParams}/>;}
