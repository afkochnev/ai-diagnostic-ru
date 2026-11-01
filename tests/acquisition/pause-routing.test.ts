import * as React from 'react';
import type {ReactElement,ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({enabled:vi.fn(),session:vi.fn(),policy:vi.fn(),questionnaire:vi.fn(),context:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/link',()=>({default:'a'}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('not_found');}}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>undefined})}));
vi.mock('@/server/acquisition/contracts',async(original)=>({...await original<typeof import('@/server/acquisition/contracts')>(),acquisitionEnabled:mocks.enabled}));
vi.mock('@/server/acquisition/service',()=>({ownSession:mocks.session,sessionRpc:vi.fn(),claimRpc:vi.fn()}));
vi.mock('@/server/acquisition/context',()=>({cookieContext:mocks.context}));
vi.mock('@/server/auth/legal',()=>({registrationPolicy:mocks.policy}));
vi.mock('@/server-runtime/supabase/admin',()=>({createAdminClient:()=>({})}));
vi.mock('@/server/diagnostic/questionnaire',()=>({loadQuestionnaire:mocks.questionnaire}));
vi.mock('@/features/diagnostic/diagnostic-runner',()=>({DiagnosticRunner:()=>null}));
vi.mock('@/features/acquisition/forms',()=>({StartForm:()=>null,ShortProfileForm:()=>null,EmailForm:()=>null,ClaimForm:()=>null}));

import FreePage from '@/app/[locale]/free/page';
import {DiagnosticRunner} from '@/features/diagnostic/diagnostic-runner';
import {StartForm,EmailForm} from '@/features/acquisition/forms';

function elements(node:ReactNode):ReactElement<Record<string,unknown>>[]{
 if(Array.isArray(node))return node.flatMap(elements);
 if(!React.isValidElement<Record<string,unknown>>(node))return [];
 return [node,...elements(node.props.children as ReactNode)];
}
const session={id:'saved-session',status:'in_progress',revision:9,current_block_id:'block-2',methodology_version_id:'pinned-version',answers:{'question-1':0,'question-2':'Сохранённая цель'},consent_version:'consent-v1'};
const page=(query:Record<string,string>={})=>FreePage({searchParams:Promise.resolve(query)});

beforeEach(()=>{
 vi.clearAllMocks();
 vi.stubGlobal('React',React);
 mocks.enabled.mockReturnValue(true);
 mocks.policy.mockResolvedValue({versions:{data_processing:'consent-v1',marketing:'marketing-v1'}});
 mocks.session.mockResolvedValue(session);
 mocks.context.mockResolvedValue({id:session.id,hash:'owned-cookie'});
 mocks.questionnaire.mockResolvedValue([{id:'block-2',questions:[]}]);
});

describe('anonymous pause and resume',()=>{
 it('offers a real pause with continuation and no login form',async()=>{
  const tree=await page({paused:'1'});
  const html=renderToStaticMarkup(tree);
  expect(html).toContain('Ответы сохранены');
  expect(html).toContain('href="/ru/free"');
  expect(html).toContain('Продолжить диагностику');
  expect(html).toContain('href="/ru"');
  expect(html).not.toContain('/ru/login');
  expect(elements(tree).some(element=>element.type===DiagnosticRunner)).toBe(false);
  expect(mocks.questionnaire).not.toHaveBeenCalled();
 });

 it('resumes the same session, block and saved answers, including the lowest score',async()=>{
  const tree=await page() as ReactElement<{anonymous:boolean;data:{diagnostic:{id:string;current_block_id:string}}}>;
  expect(tree.type).toBe(DiagnosticRunner);
  expect(tree.props.anonymous).toBe(true);
  expect(tree.props.data.diagnostic).toMatchObject({id:session.id,revision:9,current_block_id:'block-2'});
  expect(mocks.questionnaire).toHaveBeenCalledWith({},'pinned-version',[
   {question_id:'question-1',numeric_value:0,text_value:null,revision:9},
   {question_id:'question-2',numeric_value:null,text_value:'Сохранённая цель',revision:9},
  ]);
 });

 it('cannot turn a missing session into a false saved state',async()=>{
  mocks.session.mockRejectedValue(Error('acquisition_cookie_missing'));
  const tree=await page({paused:'1',utm_source:'blog'});
  expect(elements(tree).find(element=>element.type===StartForm)?.props.attribution).toEqual({utm_source:'blog'});
  expect(renderToStaticMarkup(tree)).not.toContain('Ответы сохранены');
 });

 it('keeps the email step after completed questions and company context',async()=>{
  mocks.session.mockResolvedValue({...session,status:'profile_completed'});
  const tree=await page({paused:'1'});
  expect(elements(tree).some(element=>element.type===EmailForm)).toBe(true);
  expect(elements(tree).some(element=>element.type===DiagnosticRunner)).toBe(false);
 });

 it('preserves the production gate before loading any saved session',async()=>{
  mocks.enabled.mockReturnValue(false);
  await expect(page({paused:'1'})).rejects.toThrow('not_found');
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.policy).not.toHaveBeenCalled();
 });
});
