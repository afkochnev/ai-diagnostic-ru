import { NextResponse } from "next/server";
import { z } from "zod";
import { acquisitionJson } from "@/server/acquisition/request";
import { getIdentity } from "@/server/auth/session";
import { authConfig } from "@/server/supabase/config";
import { isAppRequestOrigin } from "@/server-runtime/app-request-origin";
import { saveTeamResponseAction } from "@/server/team/actions";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import { teamSave } from "@/server/team/contracts";
import { participantResponse } from "@/server/team/service";

type Context = { params: Promise<{ participantId: string }> };
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateHeaders });
const saveSchema = teamSave.omit({ participantId: true }).extend({ revision: z.number().int().min(0) }).strict();

export async function GET(_: Request, { params }: Context) {
  if (!teamFoundationEnabled()) return json({ error: "not_found" }, 404);
  const { participantId } = await params;
  if (!z.uuid().safeParse(participantId).success) return json({ error: "not_found" }, 404);
  try {
    const identity = await getIdentity();
    if (!identity?.user.email_confirmed_at || (identity.role === "administrator" && identity.nextAal === "aal2" && identity.aal !== "aal2")) {
      return json({ error: "access_denied" }, 401);
    }
    const { revision, status, answers } = await participantResponse(participantId);
    return json({ revision, status, answers });
  } catch (error) {
    if (error instanceof Error && error.message === "team_response_unavailable") return json({ error: "not_found" }, 404);
    return json({ error: "status_unavailable" }, 503);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!teamFoundationEnabled()) return json({ error: "not_found" }, 404);
  if (!isAppRequestOrigin(request.headers, authConfig().APP_URL, true)) return json({ error: "invalid_origin" }, 403);
  const { participantId } = await params;
  if (!z.uuid().safeParse(participantId).success) return json({ error: "not_found" }, 404);

  const body = await acquisitionJson(request, 1_000_100).catch(() => null);
  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Не удалось сохранить ответы. Проверьте данные и попробуйте ещё раз." }, 400);

  const { revision, answers, submit } = parsed.data;
  const form = new FormData();
  form.set("participantId", participantId);
  form.set("revision", String(revision));
  form.set("answers", JSON.stringify(answers));
  form.set("intent", submit ? "submit" : "save");
  const result = await saveTeamResponseAction({ revision }, form);
  if (result.retryAfterSeconds !== undefined) {
    return NextResponse.json(result, { status: 429, headers: { ...privateHeaders, "Retry-After": String(result.retryAfterSeconds) } });
  }
  if (result.saveFailure === "uncertain") return json({ error: "save_unavailable" }, 503);
  return json(result, result.saveFailure === "conflict" ? 409 : result.error ? 400 : 200);
}
