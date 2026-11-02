import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const state=vi.hoisted(()=>({profile:{} as Record<string,unknown>}));
vi.mock('server-only',()=>({}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock('@/server/acquisition/actions',()=>({startAnonymous:async()=>({}),saveShortProfile:async()=>({}),sendAccess:async()=>({}),finishClaim:async()=>({}),confirmAccess:async()=>({})}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({from:(table:string)=>{
 const rows:Record<string,unknown>={diagnostics:{id:'diagnostic',version_id:'v4'},diagnostic_company_snapshots:{profile_data:state.profile},diagnostic_results:{id:'result',raw_manageability_index:50,display_manageability_index:50,maturity_level_id:'maturity'},diagnostic_blocks:Array.from({length:8},(_,i)=>({id:`b${i}`,key:`block${i}`,weight:1,position:i})),diagnostic_block_results:Array.from({length:8},(_,i)=>({block_id:`b${i}`,raw_score:50,display_score:50})),maturity_level_translations:{label:'Зона развития'},maturity_levels:{position:3},answers:[{question_id:'open',text_value:'Synthetic stated goal'}],questions:[{id:'open',key:'goal',block_id:'b0',answer_type:'text'}],question_translations:[{question_id:'open',prompt:'Цель'}],diagnostic_block_translations:Array.from({length:8},(_,i)=>({block_id:`b${i}`,title:`Область ${i}`}))};
 const q={select:()=>q,eq:()=>q,order:()=>q,single:async()=>({data:rows[table],error:null}),maybeSingle:async()=>({data:rows[table],error:null}),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve)};return q;
}})}));
import {buildAIInput} from '@/server/ai/report';
import {FreeLanding} from '@/features/acquisition/free-landing';
import {ShortProfileForm,StartForm} from '@/features/acquisition/forms';
const minimum={name:'Synthetic',industry_key:'manufacturing',employee_count:37,products:'Products',key_problems:'Stated constraint',main_goals:'Stated goals'};
beforeEach(()=>{state.profile=minimum;});
describe('same full Individual product with progressive Company context',()=>{
 it('keeps explicit versioned consent and attribution in the start form',()=>{
  const html=renderToStaticMarkup(createElement(StartForm,{policy:{temporary:false,versions:{data_processing:'consent-v2',marketing:'marketing-v1'},dataUrl:'/ru/legal/privacy/consent-v2',marketingUrl:'/ru/legal/privacy/marketing-v1'},attribution:{utm_source:'blog'}}));
  const controls=Object.fromEntries(Array.from(html.matchAll(/<input\b[^>]*>/g),match=>[match[0].match(/name="([^"]+)"/)?.[1],match[0]]));
  expect(controls.consent).toContain('type="checkbox"');expect(controls.consent).toContain('required=""');
  expect(controls.consent_version).toContain('type="hidden"');expect(controls.consent_version).toContain('value="consent-v2"');
  expect(controls.utm_source).toContain('value="blog"');expect(html).toContain('href="/ru/legal/privacy/consent-v2"');
 });
 it('preserves required profile fields, optional context and zero-valued prefills with growing textareas',()=>{
  const html=renderToStaticMarkup(createElement(ShortProfileForm,{industries:[{industry_key:'manufacturing',name:'Производство'}],revenues:[],draft:{...minimum,company_age_years:0,country:null},prefilled:true}));
  const controls=Object.fromEntries(Array.from(html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g),match=>[match[0].match(/name="([^"]+)"/)?.[1],match[0]]));
  expect(Object.keys(controls).sort()).toEqual(['name','industry_key','employee_count','products','key_problems','main_goals','country','customer_segments','sales_channels','annual_revenue_key','company_age_years','management_levels'].sort());
  for(const name of ['name','industry_key','employee_count','products','key_problems','main_goals'])expect(controls[name]).toContain('required=""');
  for(const name of ['country','customer_segments','sales_channels','annual_revenue_key','company_age_years','management_levels'])expect(controls[name]).not.toContain('required');
  expect(controls.employee_count).toContain('value="37"');expect(controls.company_age_years).toContain('value="0"');expect(controls.country).toContain('value=""');
  for(const name of ['products','key_problems','main_goals','customer_segments','sales_channels']){expect(controls[name]).toContain('<textarea');expect(controls[name]).toContain('maxLength="5000"');}
  expect(html).toContain('>Stated constraint</textarea>');expect(html).toContain('>Stated goals</textarea>');expect(html).toContain('value="manufacturing" selected=""');
 });
 it('keeps accepted scoring facts/open answers unchanged; missing context remains null',async()=>{
  const minimumInput=await buildAIInput('diagnostic');state.profile={...minimum,country:'Россия',customer_segments:'Business clients',sales_channels:'Direct',annual_revenue_key:'10m_100m',company_age_years:10,management_levels:3};const fullInput=await buildAIInput('diagnostic');
  expect(minimumInput.deterministic_results).toEqual(fullInput.deterministic_results);expect(minimumInput.block_results).toEqual(fullInput.block_results);expect(minimumInput.open_answers).toEqual(fullInput.open_answers);expect(minimumInput.derived_facts).toEqual(fullInput.derived_facts);
  expect(minimumInput.company_snapshot.employees_count).toBe(37);expect(minimumInput.company_snapshot.main_goals).toBe('Stated goals');expect(minimumInput.company_snapshot.country).toBeNull();expect(minimumInput.company_snapshot.company_age_years).toBeNull();expect(minimumInput.company_snapshot.annual_revenue).toBeNull();expect(fullInput.company_snapshot.country).toBe('Россия');
 });
 it('landing sends the primary visitor to questions rather than registration and uses only synthetic preview',()=>{
  const html=renderToStaticMarkup(createElement(FreeLanding,{authenticated:false,attribution:{utm_source:'blog.iteam.ru',utm_medium:'popup',utm_campaign:'ai_audit'}}));
  expect(html).toContain('Без регистрации');expect(html).toContain('Начать бесплатную диагностику');expect(html).toContain('/ru/free?utm_source=blog.iteam.ru');expect(html).not.toContain('/register');expect(html).toContain('30 / 60 / 90');expect(html).toContain('Вымышленный пример отчёта');expect(html).not.toContain('FoodTech');expect(html).not.toContain('₽');
 });
 it('an authenticated visitor goes to the normal workspace, not a shadow signup',()=>{
  const html=renderToStaticMarkup(createElement(FreeLanding,{authenticated:true,attribution:{}}));expect(html).toContain('href="/ru/account"');expect(html).not.toContain('href="/ru/free');
 });
});
