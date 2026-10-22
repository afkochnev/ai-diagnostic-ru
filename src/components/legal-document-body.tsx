import {Fragment, type ReactNode} from 'react';

// A deliberately small presentation layer for approved plain-text Markdown.
// React escapes all source text; no raw HTML or executable links are interpreted.
function emphasis(text:string):ReactNode[]{
 return text.split(/(\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')
  ?<strong key={i}>{part.slice(2,-2)}</strong>:part);
}

export function LegalDocumentBody({body}:{body:string}){
 const blocks:ReactNode[]=[],paragraph:string[]=[];
 function flush(){
  if(paragraph.length){blocks.push(<p key={blocks.length} className="whitespace-pre-line">{emphasis(paragraph.join('\n'))}</p>);paragraph.length=0;}
 }
 for(const line of body.split('\n')){
  const heading=/^(#{1,3}) (.+)$/.exec(line);
  if(heading){
   flush();const text=emphasis(heading[2]),key=blocks.length;
   blocks.push(heading[1].length===1?<h1 key={key} className="text-3xl font-semibold">{text}</h1>:
    heading[1].length===2?<h2 key={key} className="text-2xl font-semibold">{text}</h2>:
    <h3 key={key} className="pt-5 text-xl font-semibold">{text}</h3>);
  }else if(!line.trim())flush();else paragraph.push(line);
 }
 flush();
 return <article className="space-y-5 leading-relaxed">{blocks.map((block,i)=><Fragment key={i}>{block}</Fragment>)}</article>;
}
