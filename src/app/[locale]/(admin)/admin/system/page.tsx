import {AdminSystemPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({searchParams}:{searchParams:AdminSearch}){return <AdminSystemPage searchParams={searchParams}/>;}
