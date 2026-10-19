import { mkdirSync,writeFileSync } from 'node:fs';
import { renderTeamPdf,buildTeamPdfHtml } from '../src/server/team/pdf-render';
import { meanEvidence,reportFixture } from '../tests/team/v3-fixtures';
const input={companyName:'FoodTech — синтетический пример',teamTitle:'Командный управленческий аудит',completedAt:'2026-10-19T07:00:00Z',participantCount:4,index:'50',maturity:'Зона развития',blocks:meanEvidence().blocks.map(b=>({title:b.title,score:String(b.mean)})),content:reportFixture(),mock:true};
async function main(){const dir='../artifacts/v22c3-average-first-team-pdf/output/pdf';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/team-report-fixture.html',buildTeamPdfHtml(input));writeFileSync(dir+'/team-report-fixture.pdf',await renderTeamPdf(input));}
void main().catch(()=>{console.error('fixture_pdf_failed');process.exitCode=1;});
