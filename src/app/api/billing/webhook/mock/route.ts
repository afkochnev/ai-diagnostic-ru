import {NextResponse} from 'next/server';
import {billingConfig} from '@/server/billing/contracts';
import {processWebhook} from '@/server/billing/service';
export async function POST(request:Request){
 if(!billingConfig().enabled||billingConfig().provider!=='mock')return NextResponse.json({error:'billing_unavailable'},{status:404});
 // Stream limit also rejects chunked bodies; Content-Length is not an authority.
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
 try {const body=Buffer.concat(chunks).toString('utf8'),result=await processWebhook(body,request.headers.get('x-mock-billing-signature')??'');
 return NextResponse.json(result,{status:result.status==='retryable'?503:result.status==='rejected'?422:200});}
 catch{return NextResponse.json({error:'billing_event_rejected'},{status:400});}
}
