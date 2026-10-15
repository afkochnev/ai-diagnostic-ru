import { z } from "zod";
export const teamCreation = z.object({ companyId: z.uuid(), title: z.string().trim().min(2).max(200) });
export const teamInvitation = z.object({ teamId: z.uuid(), email: z.string().trim().toLowerCase().max(254).pipe(z.email()), displayName: z.string().trim().min(1).max(100) });
export const invitationToken = z.string().regex(/^[a-f0-9]{64}$/);
export const teamSave = z.object({ participantId: z.uuid(), revision: z.coerce.number().int().min(0), answers: z.record(z.uuid(), z.union([z.number().int().min(0).max(4), z.string().max(10000), z.null()])), submit: z.boolean() });
export type TeamQuestion = { id: string; block_id: string; block_title: string; prompt: string; help: string | null; answer_type: "scale_0_4" | "text"; required: boolean; options: { value: number; label: string }[] };
export type TeamResponse = { participant_id: string; display_name: string; title: string; status: "invited" | "started" | "completed"; revision: number; answers: Record<string, number | string | null>; questions: TeamQuestion[] };
export type TeamActionState = { error?: string; invitationUrl?: string; emailStatus?: "mock" | "sent" | "failed"; revision?: number; status?: string };
