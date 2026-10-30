/** Own numerical result only. Contains no answers, other participants or AI output. */
export type TeamParticipantResult = {
  participant_id: string;
  display_name: string;
  team_title: string;
  status: "completed";
  completed_at: string;
  overall_raw: number;
  overall_display: number;
  maturity_label: string;
  blocks: Array<{
    block_id: string;
    title: string;
    position: number;
    raw_score: number;
    display_score: number;
    question_count: number;
  }>;
};

export type ParticipantResult = TeamParticipantResult;
