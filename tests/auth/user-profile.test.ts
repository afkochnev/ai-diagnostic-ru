import {renderToStaticMarkup} from "react-dom/server";
import {createElement} from "react";
import {beforeEach, describe, expect, it, vi} from "vitest";
const mocks=vi.hoisted(()=>({identity:vi.fn(),select:vi.fn(),eq:vi.fn(),single:vi.fn(),user:vi.fn(),claims:vi.fn(),recovery:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/auth/session",()=>({requireIdentity:mocks.identity}));
vi.mock("@/server/auth/actions",()=>({resetAction:vi.fn(),logoutAction:vi.fn()}));
vi.mock("@/features/auth/auth-form",()=>({AuthForm:()=>"RESET_FORM"}));
vi.mock("@/server/auth/recovery",()=>({hasRecovery:mocks.recovery}));
vi.mock("@/server/supabase/server",()=>({createAuthClient:async()=>({
  from:()=>({select:mocks.select}),auth:{getUser:mocks.user,getClaims:mocks.claims},
})}));
import UserProfilePage from "@/app/[locale]/(workspace)/profile/page";
import ResetPasswordPage from "@/app/[locale]/(auth)/reset-password/page";
import {SiteHeader} from "@/features/landing/site-header";
import {getMessages} from "@/i18n/messages";
beforeEach(()=>{
  vi.clearAllMocks();mocks.identity.mockResolvedValue({user:{id:"current-user",email:"current@example.test"}});
  mocks.select.mockReturnValue({eq:mocks.eq});mocks.eq.mockReturnValue({single:mocks.single});
  mocks.single.mockResolvedValue({data:{full_name:"Текущий пользователь"},error:null});
  mocks.user.mockResolvedValue({data:{user:{id:"recovery-user",email:"recovery@example.test"}}});
  mocks.claims.mockResolvedValue({data:{claims:{session_id:"recovery-session"}}});mocks.recovery.mockResolvedValue(true);
});
describe("own user profile and visible recovery identity",()=>{
  it("offers the own profile only after login and keeps mobile navigation bounded and wrapped",()=>{
    const signedIn=renderToStaticMarkup(createElement(SiteHeader,{locale:"ru",messages:getMessages("ru"),signedIn:true}));
    expect(signedIn).toContain('href="/ru/profile"');expect(signedIn).toContain("Профиль пользователя");
    expect(signedIn).toContain("w-full min-w-0 flex-wrap");expect(signedIn).toContain("sm:w-auto sm:shrink-0");
    const publicHeader=renderToStaticMarkup(createElement(SiteHeader,{locale:"ru",messages:getMessages("ru"),signedIn:false}));
    expect(publicHeader).not.toContain('href="/ru/profile"');
  });
  it("shows the verified current user's name/email using only that user's RLS query",async()=>{
    const html=renderToStaticMarkup(await UserProfilePage());
    expect(mocks.eq).toHaveBeenCalledExactlyOnceWith("id","current-user");
    expect(html).toContain("Текущий пользователь");expect(html).toContain("current@example.test");
    expect(html).not.toContain("<input");expect(html).not.toContain("<form");
  });
  it("does not query profile data before the session guard succeeds",async()=>{
    mocks.identity.mockRejectedValue(Error("redirect:/ru/login"));
    await expect(UserProfilePage()).rejects.toThrow("redirect:/ru/login");expect(mocks.select).not.toHaveBeenCalled();
  });
  it("identifies the account from the verified recovery session, not form or URL input",async()=>{
    const html=renderToStaticMarkup(await ResetPasswordPage());
    expect(html).toContain("recovery@example.test");expect(html).toContain("RESET_FORM");
    expect(mocks.recovery).toHaveBeenCalledExactlyOnceWith("recovery-user","recovery-session");
    mocks.recovery.mockResolvedValue(false);
    const invalid=renderToStaticMarkup(await ResetPasswordPage());
    expect(invalid).not.toContain("RESET_FORM");expect(invalid).not.toContain("recovery@example.test");
  });
});
