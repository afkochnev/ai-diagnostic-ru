import {AdminListPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({searchParams}:{searchParams:AdminSearch}){return <AdminListPage section="feedback" searchParams={searchParams}/>;}
