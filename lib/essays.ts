import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth";
import type {
  CorrectionResult,
  EssayHistoryItem,
  UsageSnapshot,
} from "@/lib/essay-types";

type DatabaseClient = SupabaseClient;

type EssayRow = {
  id: string;
  theme: string;
  final_score: number | null;
  submitted_at: string;
  corrected_at: string | null;
  word_count: number;
  essay_scores:
    | {
        summary: string | null;
        competency_1_score: number;
        competency_2_score: number;
        competency_3_score: number;
        competency_4_score: number;
        competency_5_score: number;
      }
    | {
        summary: string | null;
        competency_1_score: number;
        competency_2_score: number;
        competency_3_score: number;
        competency_4_score: number;
        competency_5_score: number;
      }[]
    | null;
};

function getStartOfWeekInSaoPaulo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = getPart("weekday");
  const year = Number(getPart("year"));
  const month = Number(getPart("month"));
  const day = Number(getPart("day"));
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekdayNumber = weekdayMap[weekday] ?? 1;
  const diffToMonday = weekdayNumber === 0 ? 6 : weekdayNumber - 1;
  const localDate = new Date(Date.UTC(year, month - 1, day));
  localDate.setUTCDate(localDate.getUTCDate() - diffToMonday);

  return localDate.toISOString().slice(0, 10);
}

function normalizeEssayRow(row: EssayRow): EssayHistoryItem | null {
  if (!row.final_score || !row.essay_scores) {
    return null;
  }

  const score =
    Array.isArray(row.essay_scores) ? row.essay_scores[0] : row.essay_scores;

  if (!score) {
    return null;
  }

  return {
    id: row.id,
    theme: row.theme,
    finalScore: row.final_score,
    submittedAt: row.submitted_at,
    correctedAt: row.corrected_at,
    summary: score.summary ?? "",
    wordCount: row.word_count,
    competencies: [
      score.competency_1_score,
      score.competency_2_score,
      score.competency_3_score,
      score.competency_4_score,
      score.competency_5_score,
    ],
  };
}

export async function getUsageSnapshot(
  supabase: DatabaseClient,
  profile: UserProfile,
): Promise<UsageSnapshot> {
  const weekStart = getStartOfWeekInSaoPaulo();

  const [{ data: limitRow, error: limitError }, { count: correctionsUsed }, { count: savedEssaysUsed }] =
    await Promise.all([
      supabase
        .from("usage_limits")
        .select("weekly_corrections, weekly_saved_essays")
        .eq("role", profile.role)
        .single(),
      supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("event_type", "correction_saved")
        .eq("week_start", weekStart),
      supabase
        .from("usage_events")
        .select("*", { count: "exact", head: true })
        .eq("profile_id", profile.id)
        .eq("event_type", "essay_saved")
        .eq("week_start", weekStart),
    ]);

  if (limitError || !limitRow) {
    throw new Error("Não foi possível carregar os limites de uso.");
  }

  return {
    weeklyCorrectionsUsed: correctionsUsed ?? 0,
    weeklyCorrectionsLimit: limitRow.weekly_corrections,
    weeklySavedEssaysUsed: savedEssaysUsed ?? 0,
    weeklySavedEssaysLimit: limitRow.weekly_saved_essays,
  };
}

export async function getEssayHistory(
  supabase: DatabaseClient,
  profile: UserProfile,
) {
  const { data, error } = await supabase
    .from("essays")
    .select(
      `
      id,
      theme,
      final_score,
      submitted_at,
      corrected_at,
      word_count,
      essay_scores (
        summary,
        competency_1_score,
        competency_2_score,
        competency_3_score,
        competency_4_score,
        competency_5_score
      )
    `,
    )
    .eq("student_id", profile.id)
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(12);

  if (error) {
    throw new Error("Não foi possível carregar o histórico de redações.");
  }

  return ((data ?? []) as EssayRow[])
    .map(normalizeEssayRow)
    .filter((essay): essay is EssayHistoryItem => essay !== null);
}

export async function saveCorrectionResult(params: {
  supabase: DatabaseClient;
  profile: UserProfile;
  text: string;
  theme: string;
  result: CorrectionResult;
}) {
  const { supabase, profile, text, theme, result } = params;
  const finalScore = result.nota_final ?? 0;

  const { data: essay, error: essayError } = await supabase
    .from("essays")
    .insert({
      student_id: profile.id,
      corrected_by: profile.role === "student" ? null : profile.id,
      theme,
      content: text,
      word_count: text.trim().split(/\s+/).length,
      status: "corrected",
      final_score: finalScore,
      corrected_at: new Date().toISOString(),
    })
    .select("id, theme, final_score, submitted_at, corrected_at, word_count")
    .single();

  if (essayError || !essay) {
    throw new Error("Não foi possível salvar a redação corrigida.");
  }

  const { error: scoreError } = await supabase.from("essay_scores").insert({
    essay_id: essay.id,
    competency_1_score: result.competencia_1?.nota ?? 0,
    competency_1_justification: result.competencia_1?.justificativa ?? "",
    competency_1_improvement: result.competencia_1?.melhoria ?? "",
    competency_2_score: result.competencia_2?.nota ?? 0,
    competency_2_justification: result.competencia_2?.justificativa ?? "",
    competency_2_improvement: result.competencia_2?.melhoria ?? "",
    competency_3_score: result.competencia_3?.nota ?? 0,
    competency_3_justification: result.competencia_3?.justificativa ?? "",
    competency_3_improvement: result.competencia_3?.melhoria ?? "",
    competency_4_score: result.competencia_4?.nota ?? 0,
    competency_4_justification: result.competencia_4?.justificativa ?? "",
    competency_4_improvement: result.competencia_4?.melhoria ?? "",
    competency_5_score: result.competencia_5?.nota ?? 0,
    competency_5_justification: result.competencia_5?.justificativa ?? "",
    competency_5_improvement: result.competencia_5?.melhoria ?? "",
    summary: result.resumo_geral ?? "",
  });

  if (scoreError) {
    throw new Error("Não foi possível salvar o detalhamento da correção.");
  }

  const weekStart = getStartOfWeekInSaoPaulo();
  const { error: usageError } = await supabase.from("usage_events").insert([
    {
      profile_id: profile.id,
      essay_id: essay.id,
      event_type: "correction_saved",
      week_start: weekStart,
      metadata: { final_score: finalScore },
    },
    {
      profile_id: profile.id,
      essay_id: essay.id,
      event_type: "essay_saved",
      week_start: weekStart,
      metadata: { final_score: finalScore },
    },
  ]);

  if (usageError) {
    throw new Error("Não foi possível registrar o consumo semanal.");
  }

  return {
    id: essay.id,
    theme: essay.theme,
    finalScore: essay.final_score ?? 0,
    submittedAt: essay.submitted_at,
    correctedAt: essay.corrected_at,
    wordCount: essay.word_count,
    summary: result.resumo_geral ?? "",
    competencies: [
      result.competencia_1?.nota ?? 0,
      result.competencia_2?.nota ?? 0,
      result.competencia_3?.nota ?? 0,
      result.competencia_4?.nota ?? 0,
      result.competencia_5?.nota ?? 0,
    ] as [number, number, number, number, number],
  } satisfies EssayHistoryItem;
}
