import Link from "next/link";
import {AdminMetricsPage,type AdminSearch} from "@/features/admin/console-pages";
export default async function Page({searchParams}:{searchParams:AdminSearch}){return <><Link className="mb-6 inline-block underline" href="/ru/admin/metrics/funnel">Воронка бесплатной диагностики → Advanced</Link><AdminMetricsPage searchParams={searchParams}/></>;}
