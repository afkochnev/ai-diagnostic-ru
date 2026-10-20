import { lstatSync,readFileSync,unlinkSync } from "node:fs";
import { dirname } from "node:path";
/** Called only after controller approval/source/DB preflight; never prints or stores the key. */
export function consumePrivateKey(path:string) {
  const dir=lstatSync(dirname(path)),file=lstatSync(path),uid=process.getuid?.();
  if(!dir.isDirectory()||dir.isSymbolicLink()||!file.isFile()||file.isSymbolicLink()||(dir.mode&0o077)!==0||(file.mode&0o077)!==0||(uid!==undefined&&(file.uid!==uid||dir.uid!==uid)))throw new Error("quality_private_key_guard");
  const key=readFileSync(path,"utf8").trim();if(!/^sk-\S{40,}$/.test(key))throw new Error("quality_private_key_guard");
  unlinkSync(path);return key;
}
