import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserProfile } from "@/lib/auth";
import type {
  CacheSource,
  CorrectionResult,
  EssayComparison,
  EssayHistoryItem,
  MonthlyRankingView,
  RankingEntry,
  StudentSummary,
  UsageSnapshot,
} from "@/lib/essay-types";
import { getDisplayName } from "@/lib/profile-display";

type DatabaseClient = SupabaseClient;

type EssayRow = {
  id: string;
  theme: string;
  final_score: number | null;
  submitted_at: string;
  corrected_at: string | null;
  word_count: number;
  ai_model: string | null;
  cache_source: CacheSource;
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
  cache_source: CacheSource;
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
};

type EssayStatsRow = {
  student_id: string;
  final_score: number | null;
  submitted_at: string;
};

type TeacherFeedRow = {
  id: string;
  student_id: string;
  theme: string;
  final_score: number | null;
  submitted_at: string;
  corrected_at: string | null;
  word_count: number;
  ai_model: string | null;
  cache_source: CacheSource;
  essay_scores:
    | {
        summary: string | null;
      }
    | {
        summary: string | null;
      }[]
  | null;
};

type RankingEssayRow = {
  id: string;
  student_id: string;
  theme: string;
  final_score: number | null;
  submitted_at: string;
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

function getStartOfMonthInSaoPaulo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";

  return `${year}-${month}-01`;
}

function getCurrentMonthLabel() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

export function anonymizeName(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();

  if (!trimmed) {
    return "A***";
  }

  const firstLetter = trimmed[0]?.toUpperCase() ?? "A";
  return `${firstLetter}***`;
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

function getCompetenciesFromResult(
  result: CorrectionResult,
): [number, number, number, number, number] {
  return [
    result.competencia_1?.nota ?? 0,
    result.competencia_2?.nota ?? 0,
    result.competencia_3?.nota ?? 0,
    result.competencia_4?.nota ?? 0,
    result.competencia_5?.nota ?? 0,
  ];
}

function buildComparisonSummary(
  finalScoreDiff: number,
  competencyDiffs: [number, number, number, number, number],
) {
  const improvementLabels = competencyDiffs
    .map((diff, index) => ({ diff, label: `Competência ${index + 1}` }))
    .filter((item) => item.diff > 0)
    .sort((left, right) => right.diff - left.diff)
    .map((item) => item.label);

  const declineLabels = competencyDiffs
    .map((diff, index) => ({ diff, label: `Competência ${index + 1}` }))
    .filter((item) => item.diff < 0)
    .sort((left, right) => left.diff - right.diff)
    .map((item) => item.label);

  const stableLabels = competencyDiffs
    .map((diff, index) => ({ diff, label: `Competência ${index + 1}` }))
    .filter((item) => item.diff === 0)
    .map((item) => item.label);

  const opening =
    finalScoreDiff > 0
      ? `Você evoluiu ${finalScoreDiff} pontos em relação à última versão salva deste tema.`
      : finalScoreDiff < 0
        ? `Sua nota atual ficou ${Math.abs(finalScoreDiff)} pontos abaixo da última versão salva deste tema.`
        : "Sua nota final ficou no mesmo nível da última versão salva deste tema.";

  const strengths =
    improvementLabels.length > 0
      ? `As maiores melhorias apareceram em ${improvementLabels.join(", ")}.`
      : "Não houve ganho claro de pontuação nas competências.";

  const nextStep =
    declineLabels.length > 0
      ? `Ainda vale reforçar ${declineLabels.join(", ")} para recuperar consistência.`
      : stableLabels.length > 0
        ? `O próximo passo é destravar ganhos em ${stableLabels.join(", ")}.`
        : "Você conseguiu avançar sem perdas nas demais competências.";

  return `${opening} ${strengths} ${nextStep}`;
}

function getCorrectionResultFromCachedEssay(
  row: CachedEssayRow,
): CorrectionResult | null {
  const score =
    Array.isArray(row.essay_scores) ? row.essay_scores[0] : row.essay_scores;

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

  const [
    { data: limitRow, error: limitError },
    { count: correctionsUsed },
    { count: storedEssaysCount },
  ] = await Promise.all([
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
      .from("essays")
      .select("*", { count: "exact", head: true })
      .eq("student_id", profile.id)
      .eq("status", "corrected"),
  ]);

  if (limitError || !limitRow) {
    throw new Error("Não foi possível carregar os limites de uso.");
  }

  return {
    weeklyCorrectionsUsed: correctionsUsed ?? 0,
    weeklyCorrectionsLimit:
      profile.weekly_corrections_override ?? limitRow.weekly_corrections,
    storedEssaysCount: storedEssaysCount ?? 0,
    storedEssaysLimit:
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
    .limit(20);

  if (error) {
    throw new Error("Não foi possível carregar o histórico de redações.");
  }

  return ((data ?? []) as EssayRow[])
    .map(normalizeEssayRow)
    .filter((essay): essay is EssayHistoryItem => essay !== null);
}

export async function getLatestEssayComparison(
  supabase: DatabaseClient,
  profile: UserProfile,
  theme: string,
  currentResult: CorrectionResult,
): Promise<EssayComparison | null> {
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
    .eq("theme", theme)
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Não foi possível carregar a versão anterior desta redação.");
  }

  const previousEssay = data ? normalizeEssayRow(data as EssayRow) : null;

  if (!previousEssay || currentResult.nota_final === undefined) {
    return null;
  }

  const currentCompetencies = getCompetenciesFromResult(currentResult);
  const previousCompetencies = previousEssay.competencies;
  const competencyDiffs = currentCompetencies.map(
    (score, index) => score - previousCompetencies[index],
  ) as [number, number, number, number, number];
  const finalScoreDiff = currentResult.nota_final - previousEssay.finalScore;

  return {
    previousEssayId: previousEssay.id,
    previousFinalScore: previousEssay.finalScore,
    currentFinalScore: currentResult.nota_final,
    finalScoreDiff,
    previousCompetencies,
    currentCompetencies,
    competencyDiffs,
    summary: buildComparisonSummary(finalScoreDiff, competencyDiffs),
  };
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
      weekly_corrections_override
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

  const profiles = (data ?? []) as ProfileListRow[];
  const profileIds = profiles.map((profile) => profile.id);
  const essayMap = new Map<string, EssayStatsRow[]>();

  if (profileIds.length > 0) {
    const { data: essayRows, error: essaysError } = await supabase
      .from("essays")
      .select("student_id, final_score, submitted_at")
      .in("student_id", profileIds)
      .eq("status", "corrected");

    if (essaysError) {
      throw new Error("Não foi possível carregar as redações dos usuários.");
    }

    for (const essay of (essayRows ?? []) as EssayStatsRow[]) {
      const current = essayMap.get(essay.student_id) ?? [];
      current.push(essay);
      essayMap.set(essay.student_id, current);
    }
  }

  return profiles.map((row) => {
    const essays = (essayMap.get(row.id) ?? []).filter(
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
      fullName: getDisplayName(row.full_name, row.email),
      email: row.email,
      schoolName: row.school_name,
      classGroup: row.class_group,
      role: row.role,
      isActive: row.is_active,
      essayCount: scores.length,
      averageScore:
        scores.length > 0
          ? Math.round(
              scores.reduce((sum, score) => sum + score, 0) / scores.length,
            )
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
  const { data, error } = await supabase
    .from("essays")
    .select(
      `
      id,
      student_id,
      theme,
      final_score,
      submitted_at,
      corrected_at,
      word_count,
      ai_model,
      cache_source,
      essay_scores (
        summary
      )
    `,
    )
    .eq("status", "corrected")
    .order("submitted_at", { ascending: false })
    .limit(30);

  if (error) {
    throw new Error("Não foi possível carregar as redações da turma.");
  }

  const essays = (data ?? []) as TeacherFeedRow[];
  const studentIds = Array.from(new Set(essays.map((essay) => essay.student_id)));

  let profileMap = new Map<
    string,
    {
      id: string;
      fullName: string;
      email: string | null;
      schoolName: string | null;
      classGroup: string | null;
    }
  >();

  if (studentIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email, school_name, class_group")
      .in("id", studentIds);

    if (profilesError) {
      throw new Error("Não foi possível carregar os perfis dos alunos.");
    }

    profileMap = new Map(
      (profiles ?? []).map((profile) => [
        profile.id as string,
        {
          id: profile.id as string,
          fullName: getDisplayName(
            profile.full_name as string | null,
            profile.email as string | null,
          ),
          email: (profile.email as string | null) ?? null,
          schoolName: (profile.school_name as string | null) ?? null,
          classGroup: (profile.class_group as string | null) ?? null,
        },
      ]),
    );
  }

  return essays
    .map((row) => ({
      id: row.id,
      theme: row.theme,
      finalScore: row.final_score,
      submittedAt: row.submitted_at,
      correctedAt: row.corrected_at,
      wordCount: row.word_count,
      aiModel: row.ai_model,
      cacheSource: row.cache_source,
      summary:
        (Array.isArray(row.essay_scores)
          ? row.essay_scores[0]?.summary
          : row.essay_scores?.summary) ?? "",
      student:
        profileMap.get(row.student_id) ?? {
          id: row.student_id,
          fullName: "Usuário",
          email: null,
          schoolName: null,
          classGroup: null,
        },
    }))
    .filter((essay) =>
      options?.classGroup ? essay.student.classGroup === options.classGroup : true,
    );
}

export async function getMonthlyRanking(
  supabase: DatabaseClient,
  profile: UserProfile,
): Promise<MonthlyRankingView> {
  const monthStart = getStartOfMonthInSaoPaulo();
  const monthLabel = getCurrentMonthLabel();
  const { data, error } = await supabase
    .from("essays")
    .select("id, student_id, theme, final_score, submitted_at")
    .eq("status", "corrected")
    .gte("submitted_at", monthStart)
    .not("final_score", "is", null);

  if (error) {
    throw new Error("Não foi possível carregar o ranking do mês.");
  }

  const essays = (data ?? []) as RankingEssayRow[];
  const studentIds = Array.from(new Set(essays.map((essay) => essay.student_id)));

  let profileMap = new Map<
    string,
    {
      fullName: string;
      classGroup: string | null;
    }
  >();

  if (studentIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, full_name, email, class_group")
      .in("id", studentIds);

    if (profilesError) {
      throw new Error("Não foi possível carregar os participantes do ranking.");
    }

    profileMap = new Map(
      (profiles ?? []).map((row) => [
        row.id as string,
        {
          fullName: getDisplayName(
            row.full_name as string | null,
            row.email as string | null,
          ),
          classGroup: (row.class_group as string | null) ?? null,
        },
      ]),
    );
  }

  const bestByStudent = new Map<string, RankingEssayRow>();

  for (const essay of essays) {
    const current = bestByStudent.get(essay.student_id);

    if (
      !current ||
      (essay.final_score ?? 0) > (current.final_score ?? 0) ||
      ((essay.final_score ?? 0) === (current.final_score ?? 0) &&
        essay.submitted_at > current.submitted_at)
    ) {
      bestByStudent.set(essay.student_id, essay);
    }
  }

  const fullRanking = Array.from(bestByStudent.values())
    .sort((left, right) => {
      const scoreDiff = (right.final_score ?? 0) - (left.final_score ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return right.submitted_at.localeCompare(left.submitted_at);
    })
    .map((essay, index) => {
      const student = profileMap.get(essay.student_id);
      const fullName = student?.fullName ?? "Aluno";

      return {
        position: index + 1,
        studentId: essay.student_id,
        displayName:
          profile.role === "student" ? anonymizeName(fullName) : fullName,
        fullName,
        classGroup: student?.classGroup ?? null,
        bestScore: essay.final_score ?? 0,
        theme: essay.theme,
        submittedAt: essay.submitted_at,
        isCurrentUser: essay.student_id === profile.id,
      } satisfies RankingEntry;
    });

  const currentUserPosition =
    fullRanking.find((entry) => entry.studentId === profile.id)?.position ?? null;

  return {
    monthLabel,
    entries:
      profile.role === "student"
        ? fullRanking.slice(0, 5)
        : fullRanking,
    currentUserPosition,
  };
}

export async function logUsageEvent(params: {
  supabase: DatabaseClient;
  profileId: string;
  eventType:
    | "correction_requested"
    | "correction_saved"
    | "essay_saved"
    | "essay_deleted";
  essayId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { supabase, profileId, eventType, essayId = null, metadata = {} } =
    params;
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
      competency_5_improvement
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
  cacheSource?: CacheSource;
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

  await logUsageEvent({
    supabase,
    profileId: profile.id,
    essayId: essay.id,
    eventType: "essay_saved",
    metadata: { final_score: finalScore, cache_source: cacheSource },
  });

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

  return {
    result: correctionResult,
    aiModel: params.cachedEssay.ai_model,
    cacheSource: params.cacheSource,
  };
}
