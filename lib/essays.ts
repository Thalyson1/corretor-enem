import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth";
import type {
  CorrectionResult,
  EssayHistoryItem,
  StudentSummary,
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
  ai_model: string | null;
  cache_source: "fresh" | "duplicate_student" | "duplicate_global";
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

type CachedEssayRow = {
  theme: string;
  final_score: number | null;
  word_count: number;
  ai_model: string | null;
  cache_source: "fresh" | "duplicate_student" | "duplicate_global";
  essay_scores:
    | {
        competency_1_score: number;
        competency_1_justification: string | null;
        competency_1_improvement: string | null;
        competency_2_score: number;
        competency_2_justification: string | null;
        competency_2_improvement: string | null;
        competency_3_score: number;
        competency_3_justification: string | null;
        competency_3_improvement: string | null;
        competency_4_score: number;
        competency_4_justification: string | null;
        competency_4_improvement: string | null;
        competency_5_score: number;
        competency_5_justification: string | null;
        competency_5_improvement: string | null;
        summary: string | null;
      }
    | {
        competency_1_score: number;
        competency_1_justification: string | null;
        competency_1_improvement: string | null;
        competency_2_score: number;
        competency_2_justification: string | null;
        competency_2_improvement: string | null;
        competency_3_score: number;
        competency_3_justification: string | null;
        competency_3_improvement: string | null;
        competency_4_score: number;
        competency_4_justification: string | null;
        competency_4_improvement: string | null;
        competency_5_score: number;
        competency_5_justification: string | null;
        competency_5_improvement: string | null;
        summary: string | null;
      }[]
    | null;
};

type ProfileListRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  school_name: string | null;
  class_group: string | null;
  role: "student" | "teacher" | "admin";
  is_active: boolean;
  weekly_saved_essays_override: number | null;
  weekly_corrections_override: number | null;
  essays:
    | {
        final_score: number | null;
        submitted_at: string;
      }[]
    | null;
};

export function getStartOfWeekInSaoPaulo() {
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

export function buildEssayHash(text: string, theme: string) {
  return createHash("sha256")
    .update(`${theme.trim().toLowerCase()}::${text.trim().toLowerCase()}`)
    .digest("hex");
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
    aiModel: row.ai_model,
    cacheSource: row.cache_source,
  };
}

function getCorrectionResultFromCachedEssay(row: CachedEssayRow): CorrectionResult | null {
  const score = Array.isArray(row.essay_scores) ? row.essay_scores[0] : row.essay_scores;

  if (!score || row.final_score === null) {
    return null;
  }

  return {
    competencia_1: {
      nota: score.competency_1_score,
      justificativa: score.competency_1_justification ?? "",
      melhoria: score.competency_1_improvement ?? "",
    },
    competencia_2: {
      nota: score.competency_2_score,
      justificativa: score.competency_2_justification ?? "",
      melhoria: score.competency_2_improvement ?? "",
    },
    competencia_3: {
      nota: score.competency_3_score,
      justificativa: score.competency_3_justification ?? "",
      melhoria: score.competency_3_improvement ?? "",
    },
    competencia_4: {
      nota: score.competency_4_score,
      justificativa: score.competency_4_justification ?? "",
      melhoria: score.competency_4_improvement ?? "",
    },
    competencia_5: {
      nota: score.competency_5_score,
      justificativa: score.competency_5_justification ?? "",
      melhoria: score.competency_5_improvement ?? "",
    },
    nota_final: row.final_score,
    resumo_geral: score.summary ?? "",
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
    weeklyCorrectionsLimit:
      profile.weekly_corrections_override ?? limitRow.weekly_corrections,
    weeklySavedEssaysUsed: savedEssaysUsed ?? 0,
    weeklySavedEssaysLimit:
      profile.weekly_saved_essays_override ?? limitRow.weekly_saved_essays,
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
      ai_model,
      cache_source,
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

export async function getUserRoster(
  supabase: DatabaseClient,
  options?: {
    role?: "student" | "teacher" | "admin";
    classGroup?: string;
  },
) {
  let query = supabase
    .from("profiles")
    .select(
      `
      id,
      full_name,
      email,
      school_name,
      class_group,
      role,
      is_active,
      weekly_saved_essays_override,
      weekly_corrections_override,
      essays (
        final_score,
        submitted_at
      )
    `,
    )
    .order("full_name", { ascending: true });

  if (options?.role) {
    query = query.eq("role", options.role);
  }

  if (options?.classGroup) {
    query = query.eq("class_group", options.classGroup);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error("Não foi possível carregar os usuários.");
  }

  return ((data ?? []) as ProfileListRow[]).map((row) => {
    const essays = (row.essays ?? []).filter(
      (essay) => essay.final_score !== null,
    );
    const scores = essays
      .map((essay) => essay.final_score)
      .filter((score): score is number => score !== null);
    const latestEssay = essays
      .slice()
      .sort((left, right) =>
        right.submitted_at.localeCompare(left.submitted_at),
      )[0];

    return {
      id: row.id,
      fullName: row.full_name ?? "Sem nome",
      email: row.email,
      schoolName: row.school_name,
      classGroup: row.class_group,
      role: row.role,
      isActive: row.is_active,
      essayCount: scores.length,
      averageScore:
        scores.length > 0
          ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
          : null,
      bestScore: scores.length > 0 ? Math.max(...scores) : null,
      latestScore: latestEssay?.final_score ?? null,
      latestEssayAt: latestEssay?.submitted_at ?? null,
      weeklySavedEssaysOverride: row.weekly_saved_essays_override,
      weeklyCorrectionsOverride: row.weekly_corrections_override,
    } satisfies StudentSummary;
  });
}

export async function getTeacherEssayFeed(
  supabase: DatabaseClient,
  options?: {
    classGroup?: string;
  },
) {
  const query = supabase
    .from("essays")
    .select(
      `
      id,
      theme,
      final_score,
      submitted_at,
      corrected_at,
      word_count,
      ai_model,
      cache_source,
      profiles!essays_student_id_fkey (
        id,
        full_name,
        email,
        class_group
      ),
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
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(30);

  const { data, error } = await query;

  if (error) {
    throw new Error("Não foi possível carregar as redações da turma.");
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      theme: row.theme as string,
      finalScore: row.final_score as number | null,
      submittedAt: row.submitted_at as string,
      correctedAt: row.corrected_at as string | null,
      wordCount: row.word_count as number,
      aiModel: row.ai_model as string | null,
      cacheSource: row.cache_source as "fresh" | "duplicate_student" | "duplicate_global",
      summary:
        ((Array.isArray(row.essay_scores) ? row.essay_scores[0] : row.essay_scores)
          ?.summary as string | null) ?? "",
      student: {
        id: (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.id as string,
        fullName:
          ((Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.full_name as string | null) ??
          "Sem nome",
        email:
          ((Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.email as string | null) ??
          null,
        classGroup:
          ((Array.isArray(row.profiles) ? row.profiles[0] : row.profiles)?.class_group as string | null) ??
          null,
      },
    }))
    .filter((essay) =>
      options?.classGroup ? essay.student.classGroup === options.classGroup : true,
    );
}

export async function logUsageEvent(params: {
  supabase: DatabaseClient;
  profileId: string;
  eventType: "correction_requested" | "correction_saved" | "essay_saved" | "essay_deleted";
  essayId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { supabase, profileId, eventType, essayId = null, metadata = {} } = params;
  const weekStart = getStartOfWeekInSaoPaulo();

  await supabase.from("usage_events").insert({
    profile_id: profileId,
    essay_id: essayId,
    event_type: eventType,
    week_start: weekStart,
    metadata,
  });
}

export async function findCachedCorrection(
  supabase: DatabaseClient,
  profile: UserProfile,
  theme: string,
  contentHash: string,
) {
  const commonSelect = `
    theme,
    final_score,
    word_count,
    ai_model,
    cache_source,
    essay_scores (
      summary,
      competency_1_score,
      competency_1_justification,
      competency_1_improvement,
      competency_2_score,
      competency_2_justification,
      competency_2_improvement,
      competency_3_score,
      competency_3_justification,
      competency_3_improvement,
      competency_4_score,
      competency_4_justification,
      competency_4_improvement,
      competency_5_score,
      competency_5_justification,
      competency_5_improvement,
      summary
    )
  `;

  const studentMatch = await supabase
    .from("essays")
    .select(commonSelect)
    .eq("student_id", profile.id)
    .eq("theme", theme)
    .eq("content_hash", contentHash)
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (studentMatch.data) {
    return {
      cachedEssay: studentMatch.data as CachedEssayRow,
      cacheSource: "duplicate_student" as const,
    };
  }

  const globalMatch = await supabase
    .from("essays")
    .select(commonSelect)
    .eq("theme", theme)
    .eq("content_hash", contentHash)
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (globalMatch.data) {
    return {
      cachedEssay: globalMatch.data as CachedEssayRow,
      cacheSource: "duplicate_global" as const,
    };
  }

  return null;
}

export async function saveCorrectionResult(params: {
  supabase: DatabaseClient;
  profile: UserProfile;
  text: string;
  theme: string;
  result: CorrectionResult;
  contentHash: string;
  aiProvider?: string | null;
  aiModel?: string | null;
  cacheSource?: "fresh" | "duplicate_student" | "duplicate_global";
}) {
  const {
    supabase,
    profile,
    text,
    theme,
    result,
    contentHash,
    aiProvider = null,
    aiModel = null,
    cacheSource = "fresh",
  } = params;
  const finalScore = result.nota_final ?? 0;

  const { data: essay, error: essayError } = await supabase
    .from("essays")
    .insert({
      student_id: profile.id,
      corrected_by: profile.role === "student" ? null : profile.id,
      theme,
      content: text,
      content_hash: contentHash,
      word_count: text.trim().split(/\s+/).length,
      status: "corrected",
      final_score: finalScore,
      corrected_at: new Date().toISOString(),
      ai_provider: aiProvider,
      ai_model: aiModel,
      cache_source: cacheSource,
    })
    .select(
      "id, theme, final_score, submitted_at, corrected_at, word_count, ai_model, cache_source",
    )
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

  await Promise.all([
    logUsageEvent({
      supabase,
      profileId: profile.id,
      essayId: essay.id,
      eventType: "correction_saved",
      metadata: { final_score: finalScore, cache_source: cacheSource },
    }),
    logUsageEvent({
      supabase,
      profileId: profile.id,
      essayId: essay.id,
      eventType: "essay_saved",
      metadata: { final_score: finalScore, cache_source: cacheSource },
    }),
  ]);

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
    aiModel: essay.ai_model,
    cacheSource: essay.cache_source,
  } satisfies EssayHistoryItem;
}

export async function saveCorrectionFromCache(params: {
  supabase: DatabaseClient;
  profile: UserProfile;
  text: string;
  theme: string;
  contentHash: string;
  cachedEssay: CachedEssayRow;
  cacheSource: "duplicate_student" | "duplicate_global";
}) {
  const correctionResult = getCorrectionResultFromCachedEssay(params.cachedEssay);

  if (!correctionResult) {
    throw new Error("Não foi possível reaproveitar a correção em cache.");
  }

  return saveCorrectionResult({
    supabase: params.supabase,
    profile: params.profile,
    text: params.text,
    theme: params.theme,
    result: correctionResult,
    contentHash: params.contentHash,
    aiProvider: "cache",
    aiModel: params.cachedEssay.ai_model,
    cacheSource: params.cacheSource,
  });
}
