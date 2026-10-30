import { Card } from "@/components/ui/card";
import type { ParticipantResult } from "@/server/team/participant-result-contracts";
import { ParticipantResultPdfButton } from "./participant-result-pdf-button";

const score = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export function ParticipantResultView({ result }: { result: ParticipantResult }) {
  return <div className="mx-auto max-w-3xl">
    <p className="text-sm font-medium text-brand">{result.team_title}</p>
    <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Ваш результат командной диагностики</h1>
    <p className="mt-4 text-muted">{result.display_name}, спасибо за участие. Это ваша оценка системы управления компании, не личная оценка профессиональных качеств.</p>
    <p className="mt-2 text-sm text-muted">Диагностика завершена {new Date(result.completed_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</p>
    <Card className="mt-8">
      <h2 className="text-lg font-semibold">Индекс управляемости по вашим ответам</h2>
      <p className="mt-4"><span className="text-5xl font-semibold text-brand">{score(result.overall_display)}</span><span className="ml-2 text-muted">из 100</span></p>
      <p className="mt-3 text-xl font-medium">{result.maturity_label}</p>
      <p className="mt-3 text-sm text-muted">Чем выше индекс, тем более системными и устойчивыми вы оцениваете управленческие практики компании.</p>
      <ParticipantResultPdfButton participantId={result.participant_id} />
    </Card>
    <Card className="mt-6">
      <h2 className="text-2xl font-semibold">Оценки по блокам</h2>
      <p className="mt-2 text-sm text-muted">Все показатели приведены к шкале от 0 до 100. Особенности формулировок вопросов учтены при расчёте.</p>
      <ul className="mt-6 space-y-5">{result.blocks.map(block => <li key={block.block_id}>
        <div className="flex items-start justify-between gap-4"><h3 className="font-medium">{block.title}</h3><span className="shrink-0 font-semibold tabular-nums text-brand">{score(block.display_score)} / 100</span></div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={block.display_score} aria-label={`${block.title}: ${score(block.display_score)} из 100`} className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand" style={{ width: `${block.display_score}%` }} /></div>
      </li>)}</ul>
    </Card>
    <div className="mt-6 rounded-2xl bg-tint p-6 text-sm leading-relaxed text-muted">
      <h2 className="font-semibold text-brand">Конфиденциальность результата</h2>
      <p className="mt-2">Ваши ответы и индивидуальные оценки доступны только вам. Организатор видит статус прохождения, а результаты команды получает в сводном виде.</p>
      <p className="mt-2">Это результат по вашим ответам. Он может отличаться от общей оценки команды. AI-анализ здесь не формируется.</p>
    </div>
  </div>;
}
