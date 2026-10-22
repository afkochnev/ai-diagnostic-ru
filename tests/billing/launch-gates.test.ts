import {describe,expect,it} from 'vitest';
import {launchEnvironment,acquisitionStartEnabled,teamCreationEnabled,teamInvitationsEnabled} from '@/server-runtime/launch-gates';
const prod={NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'};
const stage={NODE_ENV:'production',APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'};
describe('production launch controls',()=>{
 it('keeps both production features OFF until their individual explicit enable flags',()=>{
  expect(launchEnvironment('team',prod)).toBe(false);expect(launchEnvironment('acquisition',prod)).toBe(false);
  expect(launchEnvironment('team',{...prod,TEAM_ENABLED:'true'})).toBe(true);expect(launchEnvironment('acquisition',{...prod,ACQUISITION_ENABLED:'true'})).toBe(true);
 });
 it('never accepts a production/staging mixed pair even with flags enabled',()=>{
  const mixed={...prod,TEAM_ENABLED:'true',ACQUISITION_ENABLED:'true',SUPABASE_URL:stage.SUPABASE_URL};
  expect(launchEnvironment('team',mixed)).toBe(false);expect(launchEnvironment('acquisition',mixed)).toBe(false);
 });
 it('separately stops new work while existing Team capability and acquisition continuation stay available',()=>{
  const e={...prod,TEAM_ENABLED:'true',ACQUISITION_ENABLED:'true',ACQUISITION_START_ENABLED:'false',TEAM_CREATION_ENABLED:'false',TEAM_INVITATIONS_ENABLED:'false'};
  expect(teamCreationEnabled(e)).toBe(false);expect(teamInvitationsEnabled(e)).toBe(false);expect(acquisitionStartEnabled(e)).toBe(false);
  expect(launchEnvironment('team',e)).toBe(true);expect(launchEnvironment('acquisition',e)).toBe(true);
 });
 it('preserves accepted staging behavior unless an explicit stop is applied',()=>{
  expect(teamCreationEnabled(stage)).toBe(true);expect(teamInvitationsEnabled(stage)).toBe(true);expect(acquisitionStartEnabled(stage)).toBe(true);
  expect(launchEnvironment('team',{...stage,TEAM_ENABLED:'false'})).toBe(false);
 });
});
