/** Exact direct CLI only. Admission remains inert and fully evaluated before
 * bootstrapMain awaits the bundle. No hosted mocks, public issuer or new ports. */
import {bootstrapMain} from './entry-bootstrap.mjs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await bootstrapMain()));}
 catch{console.log(JSON.stringify({status:'V27_TEAM_W2_EVIDENCE_CHANNEL_STAGING_HOLD_CAPTURE',phase:'LAUNCH_ADMISSION_OR_ENTRY_HOLD',credentialsRead:'NO_EAGER_READ',retry:false,STOP:true}));process.exitCode=1;}
}
