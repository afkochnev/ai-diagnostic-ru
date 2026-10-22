export async function limitedBillingBody(request:Request,max=16384){
 const reader=request.body?.getReader();if(!reader)throw Error('billing_invalid_body');
 let size=0;const chunks:Uint8Array[]=[];
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('billing_body_too_large');}chunks.push(value);}
 return Buffer.concat(chunks).toString('utf8');
}
