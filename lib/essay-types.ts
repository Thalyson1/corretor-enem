export type CompetencyResult = {
  nota: number;
  justificativa: string;
  melhoria: string;
};

export type RewriteSuggestion = {
  trecho_original: string;
  sugestao_reescrita: string;
  motivo: string;
};

export type EssayComparison = {
  previousEssayId: string;
  previousFinalScore: number;
  currentFinalScore: number;
  finalScoreDiff: number;
  previousCompetencies: [number, number, number, number, number];
  currentCompetencies: [number, number, number, number, number];
  competencyDiffs: [number, number, number, number, number];
  summary: string;
};

export type CorrectionResult = {
  competencia_1?: CompetencyResult;
  competencia_2?: CompetencyResult;
  competencia_3?: CompetencyResult;
  competencia_4?: CompetencyResult;
  competencia_5?: CompetencyResult;
  nota_final?: number;
  resumo_geral?: string;
  sugestoes_reescrita?: RewriteSuggestion[];
  comparacao?: EssayComparison;
  error?: string;
};

export type CacheSource = "fresh" | "duplicate_student" | "duplicate_global";

export type UsageSnapshot = {
  weeklyCorrectionsUsed: number;
  weeklyCorrectionsLimit: number;
  storedEssaysCount: number;
  storedEssaysLimit: number;
};

export type EssayHistoryItem = {
  id: string;
  theme: string;
  finalScore: number;
  submittedAt: string;
  correctedAt: string | null;
  summary: string;
  wordCount: number;
  competencies: [number, number, number, number, number];
  aiModel: string | null;
  cacheSource: CacheSource;
};

export type CorrectionResponse = CorrectionResult & {
  usage?: UsageSnapshot;
  aiModel?: string | null;
  cacheSource?: CacheSource;
};

export type SaveEssayResponse = {
  error?: string;
  savedEssay?: EssayHistoryItem;
  usage?: UsageSnapshot;
};

export type StudentSummary = {
  id: string;
  fullName: string;
  email: string | null;
  schoolName: string | null;
  classGroup: string | null;
  role: "student" | "teacher" | "admin";
  isActive: boolean;
  essayCount: number;
  averageScore: number | null;
  bestScore: number | null;
  latestScore: number | null;
  latestEssayAt: string | null;
  weeklySavedEssaysOverride: number | null;
  weeklyCorrectionsOverride: number | null;
};
