/** Bound actual streamed bytes; Content-Length is merely an early rejection. */
export async function acquisitionJson(request:Request,maxBytes=300000):Promise<unknown>{
 if(Number(request.headers.get('content-length')??0)>maxBytes)throw Error('acquisition_too_large');
 const reader=request.body?.getReader();if(!reader)throw Error('acquisition_invalid');let length=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw Error('acquisition_too_large');}chunks.push(value);}}
 finally{reader.releaseLock();}
 const data=new Uint8Array(length);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
