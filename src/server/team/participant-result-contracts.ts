/** Own scores and open answers only. Contains no other participants or AI output. */
export type TeamParticipantResult = {
  participant_id: string;
  display_name: string;
  team_title: string;
  status: "completed";
  completed_at: string;
  overall_raw: number;
  overall_display: number;
  maturity_label: string;
  open_answers: Array<{
    question_id: string;
    position: number;
    block_title: string;
    prompt: string;
    answer: string | null;
  }>;
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
