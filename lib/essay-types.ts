export type CompetencyResult = {
  nota: number;
  justificativa: string;
  melhoria: string;
};

export type CorrectionResult = {
  competencia_1?: CompetencyResult;
  competencia_2?: CompetencyResult;
  competencia_3?: CompetencyResult;
  competencia_4?: CompetencyResult;
  competencia_5?: CompetencyResult;
  nota_final?: number;
  resumo_geral?: string;
  error?: string;
};

export type UsageSnapshot = {
  weeklyCorrectionsUsed: number;
  weeklyCorrectionsLimit: number;
  weeklySavedEssaysUsed: number;
  weeklySavedEssaysLimit: number;
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
};

export type PersistedCorrectionResponse = CorrectionResult & {
  savedEssay?: EssayHistoryItem;
  usage?: UsageSnapshot;
};
