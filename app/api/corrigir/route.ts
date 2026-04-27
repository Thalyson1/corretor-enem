import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import type { UserProfile } from "@/lib/auth";
import type {
  CacheSource,
  CorrectionResponse,
  CorrectionResult,
  RewriteSuggestion,
} from "@/lib/essay-types";
import { createClient } from "@/lib/supabase/server";
import {
  buildEssayHash,
  findCachedCorrection,
  getLatestEssayComparison,
  getUsageSnapshot,
  logUsageEvent,
  saveCorrectionFromCache,
} from "@/lib/essays";

const SCORE_STEPS = [0, 40, 80, 120, 160, 200] as const;
const GEMINI_MODELOS_PARA_TESTAR = [
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;
const OPENAI_MODELOS_PARA_TESTAR = ["gpt-4.1-mini", "gpt-4o-mini"] as const;

async function getCurrentProfile() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return { supabase, session: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, is_active, school_name, class_group, weekly_saved_essays_override, weekly_corrections_override",
    )
    .eq("id", session.user.id)
    .single();

  return {
    supabase,
    session,
    profile: (profile as UserProfile | null) ?? null,
  };
}

function getQuotaErrorMessage(role: UserProfile["role"]) {
  if (role === "student") {
    return "Você atingiu o limite semanal de 10 correções. Tente novamente na próxima semana.";
  }

  if (role === "teacher") {
    return "A conta da professora atingiu o limite semanal configurado para correções.";
  }

  return "A conta atual atingiu o limite semanal configurado.";
}

function normalizeScore(score: number) {
  let closest: number = SCORE_STEPS[0];

  for (const step of SCORE_STEPS) {
    if (Math.abs(step - score) < Math.abs(closest - score)) {
      closest = step;
    }
  }

  return closest;
}

function appendPenaltyText(base: string | undefined, penalty: string) {
  const normalized = (base ?? "").trim();

  if (!normalized) {
    return penalty;
  }

  if (normalized.includes(penalty)) {
    return normalized;
  }

  return `${normalized} Penalização aplicada: ${penalty}`;
}

function normalizeSuggestions(
  suggestions: RewriteSuggestion[] | undefined,
  originalText: string,
) {
  if (!Array.isArray(suggestions)) {
    return [];
  }

  return suggestions
    .map((suggestion) => ({
      trecho_original: String(suggestion?.trecho_original ?? "").trim(),
      sugestao_reescrita: String(suggestion?.sugestao_reescrita ?? "").trim(),
      motivo: String(suggestion?.motivo ?? "").trim(),
    }))
    .filter(
      (suggestion) =>
        suggestion.trecho_original.length > 0 &&
        suggestion.sugestao_reescrita.length > 0 &&
        suggestion.motivo.length > 0 &&
        originalText.toLowerCase().includes(suggestion.trecho_original.toLowerCase()) &&
        suggestion.trecho_original.toLowerCase() !== suggestion.sugestao_reescrita.toLowerCase(),
    )
    .slice(0, 3);
}

function applyPenalty(
  result: CorrectionResult,
  key: keyof Pick<
    CorrectionResult,
    "competencia_1" | "competencia_2" | "competencia_3" | "competencia_4" | "competencia_5"
  >,
  cap: number,
  reason: string,
  improvement: string,
) {
  const comp = result[key];

  if (!comp) {
    return;
  }

  if (comp.nota > cap) {
    comp.nota = normalizeScore(cap);
    comp.justificativa = appendPenaltyText(comp.justificativa, reason);
    comp.melhoria = appendPenaltyText(comp.melhoria, improvement);
  }
}

function ensureMinimumScore(
  result: CorrectionResult,
  key: keyof Pick<
    CorrectionResult,
    "competencia_1" | "competencia_2" | "competencia_3" | "competencia_4" | "competencia_5"
  >,
  minimum: number,
) {
  const comp = result[key];

  if (!comp) {
    return;
  }

  if (comp.nota < minimum) {
    comp.nota = normalizeScore(minimum);
  }
}

function getPenaltyCount(result: CorrectionResult) {
  const components = [
    result.competencia_1,
    result.competencia_2,
    result.competencia_3,
    result.competencia_4,
    result.competencia_5,
  ];

  return components.filter((component) =>
    component?.justificativa?.includes("PenalizaÃ§Ã£o aplicada:"),
  ).length;
}

function getLowScoreCount(result: CorrectionResult) {
  const components = [
    result.competencia_1,
    result.competencia_2,
    result.competencia_3,
    result.competencia_4,
    result.competencia_5,
  ];

  return components.filter((component) => (component?.nota ?? 0) <= 120).length;
}

function recalculateFinalScore(result: CorrectionResult) {
  result.nota_final =
    (result.competencia_1?.nota ?? 0) +
    (result.competencia_2?.nota ?? 0) +
    (result.competencia_3?.nota ?? 0) +
    (result.competencia_4?.nota ?? 0) +
    (result.competencia_5?.nota ?? 0);
}

function tokenizeWords(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[a-zà-ú0-9]+/gi) ?? [];
}

function countOccurrences(text: string, patterns: RegExp[]) {
  return patterns.reduce((total, pattern) => total + (text.match(pattern)?.length ?? 0), 0);
}

function analyzeEssaySignals(text: string) {
  const normalized = text.toLowerCase();
  const paragraphCount = text
    .split(/\n\s*\n|\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0).length;
  const words = tokenizeWords(text);
  const uniqueWords = new Set(words);
  const lexicalVariety = words.length > 0 ? uniqueWords.size / words.length : 0;
  const averageWordLength =
    words.length > 0
      ? words.reduce((sum, word) => sum + word.length, 0) / words.length
      : 0;

  const connectorCount = countOccurrences(normalized, [
    /\bportanto\b/g,
    /\balem disso\b/g,
    /\bnesse sentido\b/g,
    /\bdesse modo\b/g,
    /\bassim\b/g,
    /\bentretanto\b/g,
    /\bcontudo\b/g,
    /\bpor conseguinte\b/g,
    /\bademais\b/g,
    /\blogo\b/g,
  ]);

  const genericRepertoireCount = countOccurrences(normalized, [
    /desde os primordios/g,
    /problema social/g,
    /falta de respeito/g,
    /falta de empatia/g,
    /na sociedade atual/g,
    /na contemporaneidade/g,
    /na atualidade/g,
    /e notorio/g,
    /e evidente/g,
  ]);

  const genericArgumentCount = countOccurrences(normalized, [
    /isso ocorre porque/g,
    /diversos fatores/g,
    /varios fatores/g,
    /faz-se necessario/g,
    /deve ser combatido/g,
    /precisa ser resolvido/g,
    /problema recorrente/g,
    /esse cenario/g,
    /essa problematica/g,
    /cultura de desrespeito/g,
    /falta de respeito/g,
    /e preciso conscientizar/g,
    /ha negligencia/g,
    /problema social/g,
  ]);

  const concreteDataCount = countOccurrences(text, [
    /\b\d{1,3}%\b/g,
    /\b\d{4}\b/g,
    /\b\d+(?:,\d+)?\b/g,
    /\bibge\b/gi,
    /\binep\b/gi,
    /\bipea\b/gi,
    /\bpnad\b/gi,
    /\bunesco\b/gi,
    /\boms\b/gi,
    /\bdatafolha\b/gi,
    /\bconstituicao federal\b/gi,
    /\bestatuto\b/gi,
    /\blei\b/gi,
    /\bministerio da educacao\b/gi,
  ]);

  const strongRepertoireCount = countOccurrences(normalized, [
    /constituicao federal/g,
    /codigo penal/g,
    /estatuto da crianca e do adolescente/g,
    /ibge/g,
    /inep/g,
    /ipea/g,
    /unesco/g,
    /organizacao das nacoes unidas/g,
    /machado de assis/g,
    /carolina maria de jesus/g,
    /milton santos/g,
    /paulo freire/g,
    /conceicao evaristo/g,
    /zygmunt bauman/g,
    /michel foucault/g,
    /djamila ribeiro/g,
  ]);

  const repertoireReferenceCount = countOccurrences(normalized, [
    /\bsegundo\b/g,
    /\bde acordo com\b/g,
    /\bconforme\b/g,
    /\bfilosofo\b/g,
    /\bsociologo\b/g,
    /\bescritor\b/g,
    /\bautor\b/g,
    /\bconstituicao\b/g,
    /\blei\b/g,
  ]);

  const interventionAgentCount = countOccurrences(normalized, [
    /\bgoverno\b/g,
    /\bestado\b/g,
    /\bpoder publico\b/g,
    /\bministerio\b/g,
    /\bmec\b/g,
    /\bescola\b/g,
    /\bmidia\b/g,
    /\bfamilia\b/g,
    /\bsociedade civil\b/g,
    /\bong\b/g,
  ]);

  const interventionActionCount = countOccurrences(normalized, [
    /\bdeve\b/g,
    /\bpromover\b/g,
    /\bimplementar\b/g,
    /\bcriar\b/g,
    /\bampliar\b/g,
    /\boferecer\b/g,
    /\bfiscalizar\b/g,
    /\brealizar\b/g,
    /\binvestir\b/g,
    /\bincentivar\b/g,
  ]);

  const interventionIntentCount = countOccurrences(normalized, [
    /\bpara\b/g,
    /\ba fim de\b/g,
    /\bcom o objetivo de\b/g,
    /\bvisando\b/g,
    /\bde modo a\b/g,
  ]);

  const repeatedExpressions = [
    "problema social",
    "falta de respeito",
    "falta de empatia",
    "na sociedade",
    "na atualidade",
    "desse modo",
    "nesse sentido",
  ];
  const repetitionCount = repeatedExpressions.reduce((total, expression) => {
    const matches = normalized.match(new RegExp(expression, "g"))?.length ?? 0;
    return total + Math.max(matches - 1, 0);
  }, 0);

  return {
    hasConcreteData: concreteDataCount >= 2,
    hasStrongRepertoire: strongRepertoireCount >= 1 || concreteDataCount >= 2,
    hasPertinentRepertoire:
      strongRepertoireCount >= 1 ||
      concreteDataCount >= 1 ||
      genericRepertoireCount >= 1 ||
      repertoireReferenceCount >= 1,
    hasGenericRepertoire: genericRepertoireCount >= 2,
    hasGenericArgumentation: genericArgumentCount >= 3,
    hasSophisticatedLanguage:
      lexicalVariety >= 0.52 && averageWordLength >= 4.6 && connectorCount >= 3,
    hasLexicalRepetition:
      repetitionCount >= 3 || lexicalVariety < 0.47 || connectorCount <= 1,
    hasSimpleSyntax:
      averageWordLength < 4.4 || connectorCount <= 1,
    hasRepetitionProblem: repetitionCount >= 2,
    hasSevereDevelopmentIssue: genericArgumentCount >= 4 || repetitionCount >= 4,
    hasExceptionalLanguage:
      lexicalVariety >= 0.55 && averageWordLength >= 4.8 && connectorCount >= 4,
    hasExceptionalArgumentation:
      !genericArgumentCount && repetitionCount === 0 && connectorCount >= 4,
    hasExceptionalCohesion: connectorCount >= 5 && repetitionCount === 0,
    hasOnlyFunctionalCohesion:
      connectorCount >= 2 && connectorCount < 4 && repetitionCount >= 2,
    hasRelevantRepertoire:
      genericRepertoireCount === 0 &&
      (strongRepertoireCount >= 1 || concreteDataCount >= 1),
    hasConsistentArgumentation:
      genericArgumentCount <= 1 && connectorCount >= 3 && repetitionCount <= 1,
    hasBasicEssayStructure: paragraphCount >= 3,
    hasCompleteEssayStructure: paragraphCount >= 4 && connectorCount >= 2,
    hasBasicCohesion: connectorCount >= 2,
    hasBasicIntervention:
      interventionAgentCount >= 1 &&
      interventionActionCount >= 1 &&
      interventionIntentCount >= 1,
    hasCompleteIntervention:
      normalized.includes("por meio") ||
      normalized.includes("a fim de") ||
      normalized.includes("com o objetivo de") ||
      normalized.includes("deve promover"),
    isExceptionalEssay:
      lexicalVariety >= 0.55 &&
      averageWordLength >= 4.8 &&
      connectorCount >= 4 &&
      (strongRepertoireCount >= 1 || concreteDataCount >= 1) &&
      genericArgumentCount <= 1 &&
      repetitionCount <= 1,
  };
}

function postProcessEvaluation(result: CorrectionResult, essayText: string) {
  const processed: CorrectionResult = JSON.parse(JSON.stringify(result)) as CorrectionResult;
  const signals = analyzeEssaySignals(essayText);
  processed.sugestoes_reescrita = normalizeSuggestions(
    processed.sugestoes_reescrita,
    essayText,
  );

  applyPenalty(
    processed,
    "competencia_2",
    signals.hasStrongRepertoire && !signals.hasGenericRepertoire ? 200 : 160,
    "O repertório apresentado não atingiu o nível de especificidade, aprofundamento e pertinência temática exigido para nota máxima.",
    "Use dados concretos, leis, pesquisas, fatos históricos delimitados ou referências diretamente ligadas ao tema e explique a conexão com a tese.",
  );

  if (!signals.hasConcreteData && signals.hasGenericRepertoire) {
    applyPenalty(
      processed,
      "competencia_2",
      signals.hasPertinentRepertoire
        ? 160
        : signals.hasLexicalRepetition && signals.hasSimpleSyntax
          ? 120
          : 160,
      "Houve ausência ou fragilidade de dados concretos, exemplos verificáveis ou referências consistentes para sustentar o repertório.",
      "Inclua estatísticas, pesquisas, leis, episódios históricos delimitados ou exemplos sociais concretos para sustentar o argumento.",
    );
  }

  if (signals.hasGenericArgumentation) {
    applyPenalty(
      processed,
      "competencia_3",
      160,
      "A argumentação apresentou trechos genéricos e superficiais, com desenvolvimento crítico insuficiente.",
      "Aprofunde as causas e consequências com análise mais específica, evitando fórmulas vagas e relações pouco explicadas.",
    );
  }

  if (signals.hasSevereDevelopmentIssue) {
    applyPenalty(
      processed,
      "competencia_3",
      120,
      "Foi identificada repetição de ideias e de fórmulas argumentativas, o que reduziu a progressão analítica do texto.",
      "Varie os argumentos e avance na análise a cada parágrafo, evitando repetir o mesmo raciocínio com palavras diferentes.",
    );
    applyPenalty(
      processed,
      "competencia_4",
      160,
      "A repetição de construções e encadeamentos comprometeu a fluidez argumentativa.",
      "Diversifique os conectivos e a articulação entre períodos para tornar a progressão textual mais refinada.",
    );
  }

  if (
    getPenaltyCount(processed) < 2 &&
    !signals.hasSophisticatedLanguage &&
    (signals.hasLexicalRepetition || signals.hasSimpleSyntax)
  ) {
    applyPenalty(
      processed,
      "competencia_1",
      signals.hasLexicalRepetition && signals.hasSimpleSyntax ? 120 : 160,
      "A linguagem não sustentou nível sofisticado e variado o suficiente para faixa máxima.",
      "Amplie o repertório vocabular, varie as estruturas sintáticas e refine a precisão lexical para elevar o nível de formalidade e maturidade textual.",
    );
  }

  if (!signals.hasLexicalRepetition && !signals.hasSimpleSyntax) {
    ensureMinimumScore(processed, "competencia_1", 160);
  }

  if (
    getPenaltyCount(processed) < 2 &&
    signals.hasGenericArgumentation &&
    !signals.hasConcreteData
  ) {
    applyPenalty(
      processed,
      "competencia_3",
      160,
      "A argumentação apresentou genericidade, aprofundamento insuficiente ou sustentação concreta limitada, o que impede a faixa máxima.",
      "Desenvolva relações causais e consequências de modo mais analítico, com recortes concretos, evidências e explicações menos genéricas.",
    );
  }

  if (
    getPenaltyCount(processed) < 2 &&
    (signals.hasOnlyFunctionalCohesion || signals.hasRepetitionProblem)
  ) {
    applyPenalty(
      processed,
      "competencia_4",
      160,
      "A coesão foi funcional, mas apresentou repetição ou pouca variação nos mecanismos de articulação, o que impede a faixa máxima.",
      "Aprimore a variedade de conectivos, a transição entre ideias e o refinamento do encadeamento argumentativo para alcançar maior sofisticação textual.",
    );
  }

  if (!signals.hasSevereDevelopmentIssue) {
    ensureMinimumScore(processed, "competencia_3", 160);
  }

  if (signals.hasBasicCohesion && !signals.hasOnlyFunctionalCohesion) {
    ensureMinimumScore(processed, "competencia_4", 160);
  }

  if (signals.hasPertinentRepertoire) {
    ensureMinimumScore(processed, "competencia_2", 160);
  }

  if (signals.hasBasicIntervention) {
    ensureMinimumScore(processed, "competencia_5", 160);
  }

  if (
    getPenaltyCount(processed) === 0 &&
    signals.hasLexicalRepetition &&
    signals.hasSimpleSyntax
  ) {
    applyPenalty(
      processed,
      "competencia_1",
      120,
      "O domínio linguístico foi correto, mas não atingiu nível excepcional de variedade lexical e complexidade sintática.",
      "Busque maior diversidade vocabular, períodos mais bem modulados e construções sintáticas mais complexas sem perder clareza.",
    );
  }

  if (getLowScoreCount(processed) > 1 && !signals.hasSevereDevelopmentIssue) {
    if (signals.hasPertinentRepertoire) {
      ensureMinimumScore(processed, "competencia_2", 160);
    }

    if (signals.hasBasicIntervention) {
      ensureMinimumScore(processed, "competencia_5", 160);
    }
  }

  const componentKeys = [
    "competencia_1",
    "competencia_2",
    "competencia_3",
    "competencia_4",
    "competencia_5",
  ] as const;

  for (const key of componentKeys) {
    const comp = processed[key];
    if (comp) {
      comp.nota = normalizeScore(comp.nota);
    }
  }

  recalculateFinalScore(processed);

  if (signals.hasBasicEssayStructure && (processed.nota_final ?? 0) < 480) {
    ensureMinimumScore(processed, "competencia_1", 80);
    ensureMinimumScore(processed, "competencia_2", 120);
    ensureMinimumScore(processed, "competencia_3", 120);
    ensureMinimumScore(processed, "competencia_4", 120);
    ensureMinimumScore(processed, "competencia_5", 120);

    recalculateFinalScore(processed);
  }

  const shouldApplyMedianEssayFloor =
    signals.hasBasicEssayStructure &&
    signals.hasPertinentRepertoire &&
    signals.hasBasicIntervention &&
    !signals.hasSevereDevelopmentIssue;

  if (shouldApplyMedianEssayFloor && (processed.nota_final ?? 0) < 760) {
    ensureMinimumScore(processed, "competencia_2", 160);
    ensureMinimumScore(processed, "competencia_5", 160);
    ensureMinimumScore(processed, "competencia_3", 160);
    ensureMinimumScore(processed, "competencia_4", 160);
    ensureMinimumScore(processed, "competencia_1", 120);
    recalculateFinalScore(processed);
  }

  if (
    signals.hasBasicEssayStructure &&
    !signals.hasStrongRepertoire &&
    processed.nota_final < 720
  ) {
    ensureMinimumScore(processed, "competencia_1", 120);
    ensureMinimumScore(processed, "competencia_2", 120);
    ensureMinimumScore(processed, "competencia_3", 160);
    ensureMinimumScore(processed, "competencia_4", 160);
    ensureMinimumScore(processed, "competencia_5", 160);

    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  const hasValidIntervention = (processed.competencia_5?.nota ?? 0) >= 160;
  const shouldApplyStructuredEssayFloor =
    signals.hasCompleteEssayStructure &&
    signals.hasBasicCohesion &&
    signals.hasConsistentArgumentation &&
    signals.hasRelevantRepertoire &&
    hasValidIntervention &&
    !signals.hasSevereDevelopmentIssue;

  if (shouldApplyStructuredEssayFloor && (processed.nota_final ?? 0) < 860) {
    ensureMinimumScore(processed, "competencia_1", 160);
    ensureMinimumScore(processed, "competencia_3", 160);
    ensureMinimumScore(processed, "competencia_4", 160);
    ensureMinimumScore(processed, "competencia_5", 160);
    ensureMinimumScore(processed, "competencia_2", 160);

    const structuredEssayTotal =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);

    const excellentCompetencies = [
      processed.competencia_1?.nota ?? 0,
      processed.competencia_3?.nota ?? 0,
      processed.competencia_4?.nota ?? 0,
      processed.competencia_5?.nota ?? 0,
    ].filter((score) => score >= 200).length;

    if (structuredEssayTotal < 860 || excellentCompetencies < 3) {
      if (!signals.hasGenericArgumentation) {
        ensureMinimumScore(processed, "competencia_3", 200);
      }

      if (!signals.hasLexicalRepetition && !signals.hasSimpleSyntax) {
        ensureMinimumScore(processed, "competencia_1", 200);
      }

      if (signals.hasBasicCohesion && !signals.hasOnlyFunctionalCohesion) {
        ensureMinimumScore(processed, "competencia_4", 200);
      }

      if ((processed.competencia_5?.nota ?? 0) >= 160) {
        ensureMinimumScore(processed, "competencia_5", 200);
      }
    }

    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  const canReachMaximumScore =
    signals.hasCompleteEssayStructure &&
    signals.hasBasicCohesion &&
    signals.hasExceptionalLanguage &&
    signals.hasExceptionalArgumentation &&
    (signals.hasStrongRepertoire || !signals.hasGenericRepertoire) &&
    signals.hasCompleteIntervention &&
    !signals.hasSevereDevelopmentIssue &&
    !signals.hasLexicalRepetition &&
    !signals.hasSimpleSyntax;

  if (canReachMaximumScore) {
    ensureMinimumScore(processed, "competencia_1", 200);
    ensureMinimumScore(processed, "competencia_2", 200);
    ensureMinimumScore(processed, "competencia_3", 200);
    ensureMinimumScore(processed, "competencia_4", 200);
    ensureMinimumScore(processed, "competencia_5", 200);

    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  if (processed.nota_final === 1000 && !signals.isExceptionalEssay && !canReachMaximumScore) {
    applyPenalty(
      processed,
      "competencia_2",
      160,
      "Apesar da boa construção do texto, o repertório não alcançou o nível excepcional exigido para um desempenho perfeito.",
      "Para atingir a nota máxima, utilize repertório altamente específico, aprofundado e rigorosamente articulado ao tema.",
    );
    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  if ((processed.nota_final ?? 0) > 960 && !signals.isExceptionalEssay) {
    applyPenalty(
      processed,
      "competencia_4",
      160,
      "A organização textual foi consistente, mas não suficientemente sofisticada para sustentar faixa tão elevada.",
      "Para alcançar notas acima de 960, a progressão entre ideias precisa ser muito refinada e praticamente impecável.",
    );
    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  if (processed.nota_final > 920 && !signals.isExceptionalEssay && !canReachMaximumScore) {
    applyPenalty(
      processed,
      signals.hasStrongRepertoire ? "competencia_3" : "competencia_2",
      160,
      "A redação apresentou bom desempenho global, mas ainda não atingiu o nível de excepcionalidade exigido para ultrapassar a faixa das redações boas.",
      "Para entrar na faixa de excelência, aprofunde mais a argumentação e refine a articulação entre repertório, tese e desenvolvimento crítico.",
    );
    processed.nota_final =
      (processed.competencia_1?.nota ?? 0) +
      (processed.competencia_2?.nota ?? 0) +
      (processed.competencia_3?.nota ?? 0) +
      (processed.competencia_4?.nota ?? 0) +
      (processed.competencia_5?.nota ?? 0);
  }

  if (!processed.resumo_geral) {
    processed.resumo_geral =
      "A redação apresentou qualidades relevantes, mas sofreu penalizações por critérios de rigor semelhantes aos de um corretor humano do ENEM.";
  }

  return processed;
}

function buildCorrectionPayload(
  result: CorrectionResult,
  aiModel: string | null,
  cacheSource: CacheSource,
  usage: CorrectionResponse["usage"],
): CorrectionResponse {
  return {
    ...result,
    aiModel,
    cacheSource,
    usage,
  };
}

function safePostProcessEvaluation(result: CorrectionResult, essayText: string) {
  try {
    return postProcessEvaluation(result, essayText);
  } catch (error) {
    console.error("postProcessEvaluation failed", error);
    return result;
  }
}

function isRetryableGeminiError(error: unknown) {
  const status = typeof error === "object" && error !== null ? Reflect.get(error, "status") : null;
  const message =
    typeof error === "object" && error !== null
      ? String(Reflect.get(error, "message") ?? "")
      : String(error ?? "");
  const normalizedMessage = message.toLowerCase();

  if (status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  return [
    "404",
    "not found",
    "model not found",
    "requested entity was not found",
    "is not found for api version",
    "is not supported for generatecontent",
    "rate limit",
    "quota",
    "resource exhausted",
    "too many requests",
    "overload",
    "overloaded",
    "timeout",
    "timed out",
    "deadline exceeded",
    "service unavailable",
    "unavailable",
    "temporarily unavailable",
    "try again later",
    "internal server error",
    "bad gateway",
    "gateway timeout",
  ].some((term) => normalizedMessage.includes(term));
}

function isRetryableOpenAIError(error: unknown) {
  const status = typeof error === "object" && error !== null ? Reflect.get(error, "status") : null;
  const message =
    typeof error === "object" && error !== null
      ? String(Reflect.get(error, "message") ?? "")
      : String(error ?? "");
  const normalizedMessage = message.toLowerCase();

  if (status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  return [
    "rate limit",
    "quota",
    "too many requests",
    "overload",
    "overloaded",
    "timeout",
    "timed out",
    "service unavailable",
    "unavailable",
    "temporarily unavailable",
    "try again later",
    "internal server error",
    "bad gateway",
    "gateway timeout",
  ].some((term) => normalizedMessage.includes(term));
}

function parseOpenAIOutputText(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return "";
  }

  const outputText = Reflect.get(data, "output_text");
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = Reflect.get(data, "output");
  if (!Array.isArray(output)) {
    return "";
  }

  for (const item of output) {
    if (typeof item !== "object" || item === null) {
      continue;
    }

    const content = Reflect.get(item, "content");
    if (!Array.isArray(content)) {
      continue;
    }

    for (const entry of content) {
      if (typeof entry !== "object" || entry === null) {
        continue;
      }

      const text = Reflect.get(entry, "text");
      if (typeof text === "string" && text.trim()) {
        return text.trim();
      }
    }
  }

  return "";
}

function parseCorrectionResponse(rawResponse: string) {
  const startIdx = rawResponse.indexOf("{");
  const endIdx = rawResponse.lastIndexOf("}") + 1;

  if (startIdx < 0 || endIdx <= startIdx) {
    console.error("Correction response parsing failed", {
      startIdx,
      endIdx,
      rawPreview: rawResponse.slice(0, 1200),
    });
    throw new Error("A IA retornou uma resposta fora do formato esperado.");
  }

  const jsonString = rawResponse.substring(startIdx, endIdx);
  try {
    return JSON.parse(jsonString) as CorrectionResult;
  } catch (error) {
    console.error("Correction JSON parse failed", {
      parseError: error instanceof Error ? error.message : String(error),
      jsonPreview: jsonString.slice(0, 1200),
    });
    throw new Error("A IA retornou um JSON inválido.", {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function isKnownProviderFailure(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return [
    "No momento atingimos o limite de correções. Tente novamente mais tarde.",
    "OpenAI fallback unavailable.",
    "A IA retornou uma resposta fora do formato esperado.",
    "A IA retornou um JSON inválido.",
    "A OpenAI retornou uma resposta vazia.",
    "A OpenAI retornou uma resposta não-JSON.",
  ].includes(error.message);
}

function buildErrorLog(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { error };
  }

  const cause =
    error.cause instanceof Error
      ? {
          message: error.cause.message,
          stack: error.cause.stack,
        }
      : error.cause;

  return {
    message: error.message,
    stack: error.stack,
    cause,
  };
}

function getErrorDetails(error: unknown) {
  if (!(error instanceof Error)) {
    return { message: String(error), raw: error };
  }

  const status =
    typeof error === "object" && error !== null ? Reflect.get(error, "status") : undefined;
  const code =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  const responseBody =
    typeof error === "object" && error !== null ? Reflect.get(error, "responseBody") : undefined;

  return {
    name: error.name,
    message: error.message,
    status,
    code,
    responseBody,
  };
}

function parseJsonSafely(rawText: string) {
  try {
    return {
      data: JSON.parse(rawText) as unknown,
      parseError: null,
    };
  } catch (error) {
    return {
      data: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function corrigirComFallback(
  prompt: string,
  chavesDisponiveis: string[],
) {
  let lastRetryableError: unknown = null;

  for (const key of chavesDisponiveis) {
    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of GEMINI_MODELOS_PARA_TESTAR) {
      console.info("Gemini correction attempt started", {
        model: modelName,
        apiKeyConfigured: Boolean(key),
      });

      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const rawResponse = result.response.text();
        const evaluation = parseCorrectionResponse(rawResponse);

        console.info("Gemini correction model selected", { model: modelName });

        return {
          evaluation,
          selectedModel: modelName,
        };
      } catch (error) {
        const retryable =
          isRetryableGeminiError(error) ||
          (error instanceof Error &&
            (error.message === "A IA retornou uma resposta fora do formato esperado." ||
              error.message === "A IA retornou um JSON inválido."));

        console.warn("Gemini correction attempt failed", {
          model: modelName,
          retryable,
          ...getErrorDetails(error),
        });

        if (!retryable) {
          throw error;
        }

        lastRetryableError = error;
      }
    }
  }

  throw new Error(
    "No momento atingimos o limite de correções. Tente novamente mais tarde.",
    {
      cause: lastRetryableError ?? undefined,
    },
  );
}

async function corrigirComOpenAI(prompt: string, apiKey: string) {
  let lastRetryableError: unknown = null;

  for (const modelName of OPENAI_MODELOS_PARA_TESTAR) {
    console.info("OpenAI correction attempt started", {
      model: modelName,
      apiKeyConfigured: Boolean(apiKey),
    });

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName,
          input: prompt,
          text: {
            format: {
              type: "json_object",
            },
          },
        }),
      });

      const responseText = await response.text();
      const { data, parseError } = parseJsonSafely(responseText);

      if (parseError) {
        console.error("OpenAI response parse failed", {
          model: modelName,
          status: response.status,
          parseError,
          rawBody: responseText.slice(0, 1200),
        });
        throw new Error("A OpenAI retornou uma resposta não-JSON.");
      }

      if (!response.ok) {
        const message =
          typeof data === "object" && data !== null
            ? String(
                Reflect.get(
                  typeof Reflect.get(data, "error") === "object" &&
                    Reflect.get(data, "error") !== null
                    ? (Reflect.get(data, "error") as object)
                    : data,
                  "message",
                ) ?? `OpenAI request failed with status ${response.status}`,
              )
            : `OpenAI request failed with status ${response.status}`;
        const error = Object.assign(new Error(message), {
          status: response.status,
          responseBody: responseText.slice(0, 1200),
        });

        if (!isRetryableOpenAIError(error)) {
          throw error;
        }

        console.warn("OpenAI correction attempt failed", {
          model: modelName,
          retryable: true,
          ...getErrorDetails(error),
        });

        lastRetryableError = error;
        continue;
      }

      const rawResponse = parseOpenAIOutputText(data);

      if (!rawResponse) {
        throw new Error("A OpenAI retornou uma resposta vazia.");
      }

      const evaluation = parseCorrectionResponse(rawResponse);

      console.info("OpenAI correction model selected", { model: modelName });

      return {
        evaluation,
        selectedModel: `openai:${modelName}`,
      };
    } catch (error) {
      const retryable =
        isRetryableOpenAIError(error) ||
        (error instanceof Error &&
          (error.message === "A IA retornou uma resposta fora do formato esperado." ||
            error.message === "A IA retornou um JSON inválido." ||
            error.message === "A OpenAI retornou uma resposta vazia."));

      console.warn("OpenAI correction attempt failed", {
        model: modelName,
        retryable,
        ...getErrorDetails(error),
      });

      if (!retryable) {
        throw error;
      }

      lastRetryableError = error;
    }
  }

  throw new Error("OpenAI fallback unavailable.", {
    cause: lastRetryableError ?? undefined,
  });
}

async function corrigirComFallbackEntreIAs(
  prompt: string,
  chavesDisponiveis: string[],
  openAiApiKey?: string,
) {
  try {
    return await corrigirComFallback(prompt, chavesDisponiveis);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (!openAiApiKey) {
      throw error;
    }

    console.warn("Gemini failed, switching correction provider to OpenAI.", {
      reason: error.message,
    });
    return corrigirComOpenAI(prompt, openAiApiKey);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, session, profile } = await getCurrentProfile();

    if (!session?.user || !profile) {
      return NextResponse.json(
        { error: "Você precisa estar autenticado para usar o corretor." },
        { status: 401 },
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        { error: "Sua conta está inativa no momento." },
        { status: 403 },
      );
    }

    const { texto, tema } = await request.json();
    const normalizedTheme = String(tema ?? "").trim();
    const normalizedText = String(texto ?? "").trim();

    if (!normalizedTheme) {
      return NextResponse.json(
        {
          error: "Informe o tema da redação para receber uma correção mais precisa.",
        },
        { status: 400 },
      );
    }

    const contentHash = buildEssayHash(normalizedText, normalizedTheme);
    const usageBefore = await getUsageSnapshot(supabase, profile);

    if (usageBefore.weeklyCorrectionsUsed >= usageBefore.weeklyCorrectionsLimit) {
      return NextResponse.json(
        {
          error: getQuotaErrorMessage(profile.role),
          usage: usageBefore,
        },
        { status: 403 },
      );
    }

    const numeroDePalavras = normalizedText.split(/\s+/).length;
    if (numeroDePalavras < 70) {
      const shortTextResult: CorrectionResult = {
        competencia_1: {
          nota: 0,
          justificativa: "Texto insuficiente.",
          melhoria: "Escreva pelo menos 70 palavras para que sua redação possa ser avaliada.",
        },
        competencia_2: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_3: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_4: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_5: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        nota_final: 0,
        resumo_geral:
          "REDAÇÃO ANULADA: o texto apresenta menos de 70 palavras estimadas, o que configura insuficiência de texto segundo os critérios adotados nesta plataforma.",
        sugestoes_reescrita: [],
      };

      return NextResponse.json(
        buildCorrectionPayload(shortTextResult, null, "fresh", usageBefore),
      );
    }

    const cached = await findCachedCorrection(
      supabase,
      profile,
      normalizedTheme,
      contentHash,
    );

    if (cached) {
      const cachedCorrection = await saveCorrectionFromCache({
        supabase,
        profile,
        text: normalizedText,
        theme: normalizedTheme,
        contentHash,
        cachedEssay: cached.cachedEssay,
        cacheSource: cached.cacheSource,
      });

      await logUsageEvent({
        supabase,
        profileId: profile.id,
        eventType: "correction_saved",
        metadata: {
          content_hash: contentHash,
          theme: normalizedTheme,
          cache_source: cached.cacheSource,
          ai_model: cachedCorrection.aiModel,
        },
      });

      const usageAfterCache = await getUsageSnapshot(supabase, profile);
      const processedCached = safePostProcessEvaluation(
        cachedCorrection.result,
        normalizedText,
      );
      const cachedComparison = await getLatestEssayComparison(
        supabase,
        profile,
        normalizedTheme,
        processedCached,
      );
      if (cachedComparison) {
        processedCached.comparacao = cachedComparison;
      }

      return NextResponse.json(
        buildCorrectionPayload(
          processedCached,
          cachedCorrection.aiModel,
          cachedCorrection.cacheSource,
          usageAfterCache,
        ),
      );
    }

    const chavesDisponiveis = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean);
    const openAiApiKey = process.env.OPENAI_API_KEY;

    console.info("Correction provider configuration", {
      geminiKeysConfigured: chavesDisponiveis.length,
      openAiConfigured: Boolean(openAiApiKey),
    });

    if (chavesDisponiveis.length === 0 && !openAiApiKey) {
      throw new Error("Nenhuma chave de API configurada no ambiente.");
    }

    const promptMestre = `Você é um corretor EXTREMAMENTE RIGOROSO do ENEM, treinado para simular corretores humanos experientes do INEP.

TEMA DA REDAÇÃO: "${normalizedTheme}"

META DE DISTRIBUIÇÃO:
- A maioria das boas redações deve ficar entre 880 e 940.
- Notas acima de 960 devem ser raras.
- Nota 1000 deve ser extremamente rara e reservada a textos praticamente impecáveis.
- Evite inflar notas. Na dúvida entre 200 e 160, prefira 160.

REGRA CENTRAL DE RIGOR:
- Nota 200 em qualquer competência exige desempenho excepcional, raro e claramente acima da média.
- Não use 200 com facilidade.
- Se houver qualquer traço relevante de genericidade, superficialidade, repetição, repertório pouco aprofundado ou linguagem apenas correta, reduza para 160.

CRITÉRIOS PARA 200:
1. Competência 1:
- dê 200 quando houver domínio completo da norma padrão, boa variação lexical e estruturas sintáticas complexas;
- não exija sofisticação extrema para a nota máxima;
- só reduza abaixo de 200 se houver limitação perceptível de variação, clareza ou domínio formal.

2. Competência 2:
- dê 200 quando o repertório for pertinente, bem explicado e articulado com a tese;
- não exija estatísticas, leis ou dados numéricos para a nota máxima;
- repertório genérico, decorativo ou pouco aprofundado deve ficar em 160;
- só use faixa inferior se houver fragilidade clara de pertinência ou explicação.

3. Competência 3:
- só dê 200 se a argumentação for crítica, densa e não genérica;
- se o texto usar ideias vagas como “problema social”, “falta de respeito”, “cultura de desrespeito” ou “é preciso conscientizar”, sem aprofundamento real, reduza a nota;
- se os argumentos forem superficiais, repetitivos ou pouco desenvolvidos, use no máximo 160.

4. Competência 4:
- só dê 200 se a progressão textual for muito fluida, com excelente articulação entre períodos e parágrafos;
- mesmo com boa coesão, não dê 200 automaticamente;
- repetição de conectivos, encadeamento previsível ou progressão pouco refinada impede 200;
- se a coesão for boa, mas sem sofisticação real, use no máximo 160.

5. Competência 5:
- só dê 200 se a proposta de intervenção for completa, detalhada, bem articulada e plausível;
- a intervenção precisa apresentar agente, ação, meio/modo, efeito e detalhamento consistente.

PENALIZAÇÕES OBRIGATÓRIAS:
- ausência de repertório pertinente ou explicação frágil: limite C2 em 160;
- argumentação genérica ou superficial: reduza C3;
- repetição de ideias: reduza C3 e/ou C4;
- linguagem apenas correta, mas sem sofisticação: limite C1 em 160;
- boa coesão sem sofisticação real: limite C4 em 160;
- justifique toda penalização de forma explícita na justificativa e na melhoria.

SUGESTÕES DE REESCRITA:
- selecione até 3 trechos reais da redação que precisam de melhoria;
- priorize argumento genérico, linguagem simples ou falta de precisão;
- para cada trecho, mantenha o sentido original, mas reescreva com maior formalidade, especificidade e sofisticação;
- evite exageros e não invente ideias totalmente novas;
- cada sugestão precisa conter:
  - trecho_original
  - sugestao_reescrita
  - motivo

ESCALA OFICIAL:
- 0, 40, 80, 120, 160, 200
- Use apenas esses valores.

SAÍDA:
- Retorne APENAS JSON puro.
- A nota_final deve ser a soma exata das 5 competências.

{
  "competencia_1": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_2": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_3": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_4": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_5": { "nota": 0, "justificativa": "", "melhoria": "" },
  "nota_final": 0,
  "resumo_geral": "",
  "sugestoes_reescrita": [
    {
      "trecho_original": "",
      "sugestao_reescrita": "",
      "motivo": ""
    }
  ]
}

REDAÇÃO PARA AVALIAR: "${normalizedText}"`;

    const { evaluation, selectedModel } = await corrigirComFallbackEntreIAs(
      promptMestre,
      chavesDisponiveis as string[],
      openAiApiKey,
    );
    const processedEvaluation = safePostProcessEvaluation(evaluation, normalizedText);
    const comparison = await getLatestEssayComparison(
      supabase,
      profile,
      normalizedTheme,
      processedEvaluation,
    );
    if (comparison) {
      processedEvaluation.comparacao = comparison;
    }

    await logUsageEvent({
      supabase,
      profileId: profile.id,
      eventType: "correction_saved",
      metadata: {
        content_hash: contentHash,
        theme: normalizedTheme,
        cache_source: "fresh",
        ai_model: selectedModel,
      },
    });

    const usageAfter = await getUsageSnapshot(supabase, profile);

    return NextResponse.json(
      buildCorrectionPayload(processedEvaluation, selectedModel, "fresh", usageAfter),
    );
  } catch (error) {
    console.error("corrigir route failed", buildErrorLog(error));

    if (isKnownProviderFailure(error)) {
      return NextResponse.json(
        {
          error: "No momento atingimos o limite de correções. Tente novamente mais tarde.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "Ocorreu um erro ao processar sua nota. Tente novamente em 2 minutos." },
      { status: 500 },
    );
  }
}
