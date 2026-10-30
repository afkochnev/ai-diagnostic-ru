import {describe,it,expect} from 'vitest';
import {accessEmailSent,profileFromAnswers,sessionLoadFailure} from '@/server/acquisition/view-state';

describe('visitor completion states',()=>{
 it('offers a fresh start only when there is no saved credential or explicit expiry',()=>{
  expect(sessionLoadFailure(Error('acquisition_cookie_missing'),false)).toBe('new');
  expect(sessionLoadFailure(Error('acquisition_expired'),true)).toBe('expired');
  expect(sessionLoadFailure(Error('network unavailable'),true)).toBe('unavailable');
  expect(sessionLoadFailure(Error('acquisition_cookie_missing'),true)).toBe('unavailable');
 });
 it('does not claim a reserved but failed email was sent',()=>{
  expect(accessEmailSent({email_requested_at:'2026-10-30T10:02:00Z',email_sent_at:null})).toBe(false);
  expect(accessEmailSent({email_requested_at:'2026-10-30T10:02:00Z',email_sent_at:'2026-10-30T10:00:01Z'})).toBe(false);
  expect(accessEmailSent({email_requested_at:'2026-10-30T10:02:00Z',email_sent_at:'2026-10-30T10:02:01Z'})).toBe(true);
 });
 it('carries the two relevant answers into company context and preserves an edited draft',()=>{
  const questions=[{id:'problem',key:'main_management_problem'},{id:'goal',key:'main_company_goal'},{id:'other',key:'another_question'}];
  const answers={problem:'Ограничение',goal:'Цель',other:'Лишний текст'};
  expect(profileFromAnswers(questions,answers,null)).toEqual({key_problems:'Ограничение',main_goals:'Цель'});
  expect(profileFromAnswers(questions,answers,{key_problems:'Уточнено'})).toEqual({key_problems:'Уточнено',main_goals:'Цель'});
  expect(profileFromAnswers(questions,{problem:3},null)).toEqual({});
 });
});
