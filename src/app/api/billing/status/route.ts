import {NextResponse} from 'next/server';
import {readCheckout} from '@/server/billing/service';
export async function GET(request:Request){try{const c=await readCheckout(new URL(request.url).searchParams.get('checkout')??'');return NextResponse.json({status:c.status},{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}});}}
