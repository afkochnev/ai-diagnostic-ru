import {Container} from "@/components/ui/container";
import {requireIdentity} from "@/server/auth/session";
import {createAuthClient} from "@/server/supabase/server";

export default async function UserProfilePage() {
  const identity = await requireIdentity();
  const client = await createAuthClient();
  const {data, error} = await client.from("users").select("full_name").eq("id", identity.user.id).single();
  return <main id="main-content" className="py-10"><Container>
    <h1 className="text-3xl font-semibold">Профиль пользователя</h1>
    <p className="mt-3 text-muted">Сведения о пользователе, под которым вы сейчас вошли.</p>
    <dl className="mt-8 max-w-xl space-y-6 rounded-2xl border border-line bg-white p-6">
      <div><dt className="text-sm text-muted">Имя</dt><dd className="mt-1 break-words font-semibold">{error || !data ? "Не удалось загрузить имя. Обновите страницу." : data.full_name}</dd></div>
      <div><dt className="text-sm text-muted">Email для входа</dt><dd className="mt-1 break-all font-semibold">{identity.user.email}</dd></div>
    </dl>
  </Container></main>;
}
