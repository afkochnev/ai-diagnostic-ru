import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.generated";
import type { TeamResponse } from "./contracts";
import { teamFoundationEnabled } from "./capabilities";

type TeamRow = { id: string; company_id: string; title: string; status: string; version_id: string; created_at: string; created_by_user_id: string };
type ParticipantRow = { id: string; team_diagnostic_id: string; email: string; display_name: string; status: string; invited_at: string; started_at: string | null; completed_at: string | null; revoked_at: string | null };
type Table<Row> = { Row: Row; Insert: never; Update: never; Relationships: [] };
// Additive draft schema contract, checked against the local PostgreSQL migration.
// Legacy generated schema stays unchanged until a reviewed migration rollout.
type TeamDatabase = Database & { public: { Tables: { team_diagnostics: Table<TeamRow>; team_participants: Table<ParticipantRow> } } };
export async function teamClient() {
  if (!teamFoundationEnabled()) throw new Error("team_unavailable");
  const client = await createAuthClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user?.email_confirmed_at) throw new Error("team_unauthorized");
  return { client: client as unknown as SupabaseClient<TeamDatabase>, user };
}
export async function teamRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { client } = await teamClient();
  const { data, error } = await (client as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }> }).rpc(name, args);
  if (error) {
    const safe = ["team_not_found", "team_closed", "team_invalid_input", "team_already_invited", "team_participant_limit", "team_invitation_unavailable", "team_response_unavailable", "team_revision_conflict", "team_response_completed", "team_invalid_answers", "team_required_answers_missing", "team_methodology_missing", "team_policy_changed"];
    throw new Error(safe.includes(error.message) ? error.message : "team_request_failed");
  }
  return data;
}
export async function listTeams(companyId: string) {
  const { client } = await teamClient();
  const { data, error } = await client.from("team_diagnostics").select("*").eq("company_id", companyId).order("created_at", { ascending: false });
  if (error) throw new Error("team_request_failed");
  return data ?? [];
}
export async function ownerTeam(teamId: string) {
  const { client } = await teamClient();
  const { data: team, error } = await client.from("team_diagnostics").select("*").eq("id", teamId).maybeSingle();
  if (error || !team) return null;
  // This table contains only owner-safe metadata. Never fetch answers for this page.
  const { data: participants, error: participantError } = await client.from("team_participants").select("*").eq("team_diagnostic_id", team.id).order("invited_at");
  if (participantError) throw new Error("team_request_failed");
  return { team, participants: participants ?? [] };
}
export async function invitationCompany(companyId:string) {
  const {client}=await teamClient();
  const {data,error}=await client.from("company_profiles").select("name").eq("id",companyId).single();
  if(error || !data)throw new Error("team_not_found");
  return data.name;
}
export function participantResponse(participantId: string) { return teamRpc<TeamResponse>("read_team_response", { p_participant_id: participantId }); }
