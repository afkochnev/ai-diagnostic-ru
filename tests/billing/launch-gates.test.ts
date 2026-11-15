import {describe,expect,it} from 'vitest';
import {launchEnvironment,acquisitionStartEnabled,teamCreationEnabled,teamInvitationsEnabled,teamProductEnabled} from '@/server-runtime/launch-gates';
const productionOrigins = ['https://audit.iteam.ru', 'https://audit.iteamsystems.com'];
const prod={NODE_ENV:'production',APP_URL:'https://audit.iteam.ru',SUPABASE_URL:'https://fhvxqeaujjeiflanqsbg.supabase.co'};
const stage={NODE_ENV:'production',APP_URL:'https://ai-diagnostic-staging-web.onrender.com',SUPABASE_URL:'https://vflgxgdwlftlyjslyrmo.supabase.co'};
describe('production launch controls',()=>{
 it.each(productionOrigins)('requires explicit production flags on %s', (origin) => {
  const env = { ...prod, APP_URL: origin };
  expect(launchEnvironment('team', env)).toBe(false);
  expect(launchEnvironment('acquisition', env)).toBe(false);
  expect(teamProductEnabled(env)).toBe(false);
  expect(launchEnvironment('team', { ...env, TEAM_ENABLED: 'true' })).toBe(true);
  expect(launchEnvironment('acquisition', { ...env, ACQUISITION_ENABLED: 'true' })).toBe(true);
  expect(teamProductEnabled({ ...env, TEAM_ENABLED: 'true' })).toBe(false);
  expect(teamProductEnabled({ ...env, TEAM_ENABLED: 'true', TEAM_PRODUCT_ENABLED: 'true' })).toBe(true);
 });
 it.each([
  'https://iteam.ru', 'https://www.iteam.ru', 'https://iteamsystems.com', 'https://www.iteamsystems.com',
  'https://audit.iteam.ru.evil.test', 'https://audit.iteamsystems.com.evil',
  'http://audit.iteam.ru', 'http://audit.iteamsystems.com', 'https://audit.iteam.ru:443',
  'https://audit.iteam.ru/', 'https://audit.iteam.ru/ru', 'https://audit.iteamsystems.com/ru',
 ])('rejects unlisted production origin %s with all flags enabled',origin=>{
  const env={...prod,APP_URL:origin,TEAM_ENABLED:'true',ACQUISITION_ENABLED:'true',TEAM_PRODUCT_ENABLED:'true'};
  expect(launchEnvironment('team',env)).toBe(false);expect(launchEnvironment('acquisition',env)).toBe(false);expect(teamProductEnabled(env)).toBe(false);
 });
 it('keeps local acceptance separate from production',()=>{
  const env={NODE_ENV:'test',APP_URL:'http://127.0.0.1:3000',SUPABASE_URL:'http://127.0.0.1:55321',TEAM_LOCAL_ACCEPTANCE:'1'};
  expect(teamCreationEnabled(env)).toBe(true);expect(teamInvitationsEnabled(env)).toBe(true);expect(acquisitionStartEnabled(env)).toBe(true);expect(teamProductEnabled(env)).toBe(false);
  expect(teamCreationEnabled({...env,TEAM_LOCAL_ACCEPTANCE:undefined})).toBe(false);expect(acquisitionStartEnabled({...env,NODE_ENV:'production'})).toBe(false);
 });
 it.each(productionOrigins)('rejects %s paired with the staging database', (origin) => {
  const mixed = { ...prod, APP_URL: origin, SUPABASE_URL: stage.SUPABASE_URL, TEAM_ENABLED: 'true', ACQUISITION_ENABLED: 'true', TEAM_PRODUCT_ENABLED: 'true' };
  expect(launchEnvironment('team', mixed)).toBe(false);
  expect(launchEnvironment('acquisition', mixed)).toBe(false);
  expect(teamProductEnabled(mixed)).toBe(false);
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
