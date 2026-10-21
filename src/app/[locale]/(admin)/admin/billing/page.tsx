import {AdminBillingPage} from '@/features/billing/admin';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const raw=await searchParams;return <AdminBillingPage filters={Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]))}/>;}
