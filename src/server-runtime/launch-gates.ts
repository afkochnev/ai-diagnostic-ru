type Env=Record<string,string|undefined>;
export function launchEnvironment(feature:'team'|'acquisition',env:Env=process.env){
 const staging=env.APP_URL==='https://ai-diagnostic-staging-web.onrender.com'&&env.SUPABASE_URL==='https://vflgxgdwlftlyjslyrmo.supabase.co';
 const local=env.NODE_ENV!=='production'&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.APP_URL??'')&&/^http:\/\/127\.0\.0\.1:\d+$/.test(env.SUPABASE_URL??'')&&(feature!=='team'||env.TEAM_LOCAL_ACCEPTANCE==='1');
 const production=env.APP_URL==='https://audit.iteam.ru'&&env.SUPABASE_URL==='https://fhvxqeaujjeiflanqsbg.supabase.co';
 const toggle=feature==='team'?env.TEAM_ENABLED:env.ACQUISITION_ENABLED;
 return (staging||local)?toggle!=='false':production&&toggle==='true';
}
export function acquisitionStartEnabled(env:Env=process.env){return launchEnvironment('acquisition',env)&&env.ACQUISITION_START_ENABLED!=='false';}
export function teamCreationEnabled(env:Env=process.env){return launchEnvironment('team',env)&&env.TEAM_CREATION_ENABLED!=='false';}
export function teamInvitationsEnabled(env:Env=process.env){return launchEnvironment('team',env)&&env.TEAM_INVITATIONS_ENABLED!=='false';}

/** An ordinary production launch is independent of historical controlled runs. */
export function teamProductEnabled(env:Env=process.env){return env.NODE_ENV==='production'&&env.APP_URL==='https://audit.iteam.ru'&&env.SUPABASE_URL==='https://fhvxqeaujjeiflanqsbg.supabase.co'&&env.TEAM_ENABLED==='true'&&env.TEAM_PRODUCT_ENABLED==='true';}
