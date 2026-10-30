import "server-only";
import type { TeamParticipantResult } from "./participant-result-contracts";
import { teamRpc } from "./service";

/** Database authorization binds this request to the current, verified participant. */
export function getParticipantResult(participantId: string) {
  return teamRpc<TeamParticipantResult>("read_team_participant_result", { p_participant_id: participantId });
}
