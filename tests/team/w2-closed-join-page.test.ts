import {expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
const s=vi.hoisted(()=>({auth:vi.fn(),policy:vi.fn(),view:vi.fn()}));
vi.mock('@/server/team/capabilities',()=>({teamFoundationEnabled:()=>false}));
vi.mock('@/server/supabase/server',()=>({createAuthClient:s.auth}));
vi.mock('@/server/auth/legal',()=>({registrationPolicy:s.policy}));
vi.mock('@/server/team/entry-context',()=>({teamEntryView:s.view}));
vi.mock('@/features/team/join',()=>({TeamJoin:()=>null}));
import JoinPage from '@/app/[locale]/team/join/page';
it('closed Team gate gives neutral unavailable UX without Auth, consent, token echo or resend control',async()=>{
 const html=renderToStaticMarkup(await JoinPage());
 expect(html).toContain('Приглашение временно недоступно');expect(html).not.toContain('404');expect(html).not.toContain('checkbox');expect(html).not.toContain('token');expect(html).not.toContain('Отправить');
 expect(s.auth).not.toHaveBeenCalled();expect(s.policy).not.toHaveBeenCalled();expect(s.view).not.toHaveBeenCalled();
});
