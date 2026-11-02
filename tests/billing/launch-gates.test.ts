import {describe,expect,it} from 'vitest';
import {launchEnvironment,acquisitionStartEnabled,teamCreationEnabled,teamInvitationsEnabled,teamProductEnabled} from '@/server-runtime/launch-gates';
const prod={NODE_ENV:'production',APP_URL:'https://iteamsystems.com',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'};
const stage={NODE_ENV:'production',APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'};
describe('production launch controls',()=>{
 it('keeps both production features OFF until their individual explicit enable flags',()=>{
  expect(launchEnvironment('team',prod)).toBe(false);expect(launchEnvironment('acquisition',prod)).toBe(false);
  expect(launchEnvironment('team',{...prod,TEAM_ENABLED:'true'})).toBe(true);expect(launchEnvironment('acquisition',{...prod,ACQUISITION_ENABLED:'true'})).toBe(true);
 });
 it.each(['https://audit.iteam.ru','https://www.iteamsystems.com','https://audit.iteamsystems.com','https://iteamsystems.com.evil','http://iteamsystems.com','https://iteamsystems.com/ru'])('rejects noncanonical production origin %s even with all flags enabled',origin=>{
  const env={...prod,APP_URL:origin,TEAM_ENABLED:'true',ACQUISITION_ENABLED:'true',TEAM_PRODUCT_ENABLED:'true'};
  expect(launchEnvironment('team',env)).toBe(false);expect(launchEnvironment('acquisition',env)).toBe(false);expect(teamProductEnabled(env)).toBe(false);
 });
 it('keeps local acceptance separate from production',()=>{
  const env={NODE_ENV:'test',APP_URL:'http://127.0.0.1:3000',SUPABASE_URL:'http://127.0.0.1:55321',TEAM_LOCAL_ACCEPTANCE:'1'};
  expect(teamCreationEnabled(env)).toBe(true);expect(teamInvitationsEnabled(env)).toBe(true);expect(acquisitionStartEnabled(env)).toBe(true);expect(teamProductEnabled(env)).toBe(false);
  expect(teamCreationEnabled({...env,TEAM_LOCAL_ACCEPTANCE:undefined})).toBe(false);expect(acquisitionStartEnabled({...env,NODE_ENV:'production'})).toBe(false);
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
