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
    return false;
  }

  if (comp.nota > cap) {
    comp.nota = normalizeScore(cap);
    comp.justificativa = appendPenaltyText(comp.justificativa, reason);
    comp.melhoria = appendPenaltyText(comp.melhoria, improvement);
    return true;
  }

  return false;
}

function reduceScore(
  result: CorrectionResult,
  key: keyof Pick<
    CorrectionResult,
    "competencia_1" | "competencia_2" | "competencia_3" | "competencia_4" | "competencia_5"
  >,
  amount: number,
  reason: string,
  improvement: string,
) {
  const comp = result[key];

  if (!comp) {
    return false;
  }

  const nextScore = Math.max(0, comp.nota - amount);

  if (nextScore < comp.nota) {
    comp.nota = normalizeScore(nextScore);
    comp.justificativa = appendPenaltyText(comp.justificativa, reason);
    comp.melhoria = appendPenaltyText(comp.melhoria, improvement);
    return true;
  }

  return false;
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
  const normalizedWithoutAccents = normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
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

  const explanationMarkerCount = countOccurrences(normalizedWithoutAccents, [
    /\bporque\b/g,
    /\bpois\b/g,
    /\buma vez que\b/g,
    /\bja que\b/g,
    /\bisso ocorre\b/g,
    /\bo que\b/g,
    /\bde modo que\b/g,
    /\bpor isso\b/g,
    /\bdesse modo\b/g,
    /\bassim\b/g,
    /\bportanto\b/g,
    /\bcomo consequencia\b/g,
    /\bcomo resultado\b/g,
    /\bem razao de\b/g,
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

  const genericInterventionCount = countOccurrences(normalized, [
    /\bconscientiza/g,
    /\bcampanha/g,
    /\bcampanhas/g,
    /\bprojeto social/g,
    /\bmedidas necessarias/g,
    /\bmais investimentos/g,
    /\bdebates nas escolas/g,
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
    hasConcreteSupport: concreteDataCount >= 1,
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
    hasDecorativeRepertoire:
      repertoireReferenceCount >= 1 &&
      strongRepertoireCount === 0 &&
      concreteDataCount === 0 &&
      explanationMarkerCount <= 2,
    hasConsistentArgumentation:
      genericArgumentCount <= 1 && connectorCount >= 3 && repetitionCount <= 1,
    hasDevelopedArgumentation:
      explanationMarkerCount >= 3 &&
      genericArgumentCount <= 1 &&
      repetitionCount <= 1,
    hasGoodCohesion: connectorCount >= 3 && !repetitionCount,
    hasSuperficialDevelopment:
      genericArgumentCount >= 2 &&
      explanationMarkerCount <= 2 &&
      concreteDataCount === 0,
    hasLowDensity:
      strongRepertoireCount === 0 &&
      concreteDataCount === 0 &&
      genericArgumentCount >= 2 &&
      explanationMarkerCount <= 2,
    hasBasicEssayStructure: paragraphCount >= 3,
    hasCompleteEssayStructure: paragraphCount >= 4 && connectorCount >= 2,
    hasBasicCohesion: connectorCount >= 2,
    hasBasicIntervention:
      interventionAgentCount >= 1 &&
      interventionActionCount >= 1 &&
      interventionIntentCount >= 1,
    hasGenericIntervention: genericInterventionCount >= 2,
    hasDetailedIntervention:
      interventionAgentCount >= 1 &&
      interventionActionCount >= 2 &&
      interventionIntentCount >= 1 &&
      genericInterventionCount === 0,
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
  const beforeScores = {
    competencia_1: result.competencia_1?.nota ?? 0,
    competencia_2: result.competencia_2?.nota ?? 0,
    competencia_3: result.competencia_3?.nota ?? 0,
    competencia_4: result.competencia_4?.nota ?? 0,
    competencia_5: result.competencia_5?.nota ?? 0,
    nota_final: result.nota_final ?? 0,
  };
  const penaltiesApplied: Array<{
    competencia: string;
    from: number;
    to: number;
    type: "cap" | "reduction";
    amount: number;
    reason: string;
  }> = [];
  const hasHighQualityFoundation =
    signals.hasCompleteEssayStructure &&
    (signals.hasStrongRepertoire || signals.hasConcreteSupport) &&
    signals.hasDevelopedArgumentation &&
    signals.hasCompleteIntervention &&
    signals.hasGoodCohesion;
  const applyTrackedPenalty = (
    key: keyof Pick<
      CorrectionResult,
      "competencia_1" | "competencia_2" | "competencia_3" | "competencia_4" | "competencia_5"
    >,
    cap: number,
    reason: string,
    improvement: string,
  ) => {
    const before = processed[key]?.nota ?? 0;
    const changed = applyPenalty(processed, key, cap, reason, improvement);

    if (changed) {
      penaltiesApplied.push({
        competencia: key,
        from: before,
        to: processed[key]?.nota ?? before,
        type: "cap",
        amount: before - (processed[key]?.nota ?? before),
        reason,
      });
    }

    return changed;
  };
  const applyTrackedReduction = (
    key: keyof Pick<
      CorrectionResult,
      "competencia_1" | "competencia_2" | "competencia_3" | "competencia_4" | "competencia_5"
    >,
    amount: number,
    reason: string,
    improvement: string,
  ) => {
    const before = processed[key]?.nota ?? 0;
    const changed = reduceScore(processed, key, amount, reason, improvement);

    if (changed) {
      penaltiesApplied.push({
        competencia: key,
        from: before,
        to: processed[key]?.nota ?? before,
        type: "reduction",
        amount: before - (processed[key]?.nota ?? before),
        reason,
      });
    }

    return changed;
  };
  processed.sugestoes_reescrita = normalizeSuggestions(
    processed.sugestoes_reescrita,
    essayText,
  );

  if (!signals.hasStrongRepertoire && !signals.hasConcreteSupport) {
    applyTrackedPenalty(
      "competencia_2",
      160,
      "O repertório apresentado não atingiu o nível de especificidade, aprofundamento e pertinência temática exigido para nota máxima.",
      "Use dados concretos, leis, pesquisas, fatos históricos delimitados ou referências diretamente ligadas ao tema e explique a conexão com a tese.",
    );
  }

  if (!signals.hasConcreteData && signals.hasGenericRepertoire) {
    applyTrackedPenalty(
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

  if (signals.hasDecorativeRepertoire) {
    applyTrackedReduction(
      "competencia_2",
      40,
      "O repertório foi apenas citado ou mencionado de forma decorativa, sem explicação suficiente de sua relação com o tema e com a tese.",
      "Explique com mais clareza como a referência escolhida ajuda a interpretar o problema debatido e sustenta o argumento desenvolvido.",
    );
  }

  if (signals.hasGenericArgumentation) {
    applyTrackedPenalty(
      "competencia_3",
      160,
      "A argumentação apresentou trechos genéricos e superficiais, com desenvolvimento crítico insuficiente.",
      "Aprofunde as causas e consequências com análise mais específica, evitando fórmulas vagas e relações pouco explicadas.",
    );
  }

  if (signals.hasSuperficialDevelopment) {
    applyTrackedReduction(
      "competencia_3",
      40,
      "Os argumentos permaneceram superficiais, com generalizações frequentes e pouco desenvolvimento de causas, consequências ou mecanismos do problema.",
      "Aprofunde cada argumento com encadeamento causal, consequências concretas e explicações mais específicas, evitando afirmações amplas demais.",
    );
  }

  if (signals.hasSevereDevelopmentIssue) {
    applyTrackedReduction(
      "competencia_3",
      40,
      "Foi identificada repetição de ideias e de fórmulas argumentativas, o que reduziu a progressão analítica do texto.",
      "Varie os argumentos e avance na análise a cada parágrafo, evitando repetir o mesmo raciocínio com palavras diferentes.",
    );
    applyTrackedReduction(
      "competencia_4",
      40,
      "A repetição de construções e encadeamentos comprometeu a fluidez argumentativa.",
      "Diversifique os conectivos e a articulação entre períodos para tornar a progressão textual mais refinada.",
    );
  }

  if (
    getPenaltyCount(processed) < 2 &&
    !signals.hasSophisticatedLanguage &&
    (signals.hasLexicalRepetition || signals.hasSimpleSyntax)
  ) {
    applyTrackedPenalty(
      "competencia_1",
      signals.hasLexicalRepetition && signals.hasSimpleSyntax ? 120 : 160,
      "A linguagem não sustentou nível sofisticado e variado o suficiente para faixa máxima.",
      "Amplie o repertório vocabular, varie as estruturas sintáticas e refine a precisão lexical para elevar o nível de formalidade e maturidade textual.",
    );
  }

  if (
    getPenaltyCount(processed) < 2 &&
    signals.hasGenericArgumentation &&
    !signals.hasConcreteData
  ) {
    applyTrackedPenalty(
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
    applyTrackedPenalty(
      "competencia_4",
      160,
      "A coesão foi funcional, mas apresentou repetição ou pouca variação nos mecanismos de articulação, o que impede a faixa máxima.",
      "Aprimore a variedade de conectivos, a transição entre ideias e o refinamento do encadeamento argumentativo para alcançar maior sofisticação textual.",
    );
  }

  if (signals.hasGenericIntervention) {
    applyTrackedPenalty(
      "competencia_5",
      160,
      "A proposta de intervenção ficou genérica e pouco detalhada para sustentar a faixa máxima.",
      "Detalhe melhor agente, ação, meio de execução e efeito esperado para tornar a proposta mais completa e consistente.",
    );
  }

  if (
    getPenaltyCount(processed) === 0 &&
    signals.hasLexicalRepetition &&
    signals.hasSimpleSyntax
  ) {
    applyTrackedPenalty(
      "competencia_1",
      120,
      "O domínio linguístico foi correto, mas não atingiu nível excepcional de variedade lexical e complexidade sintática.",
      "Busque maior diversidade vocabular, períodos mais bem modulados e construções sintáticas mais complexas sem perder clareza.",
    );
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

  if (signals.hasLowDensity && !hasHighQualityFoundation) {
    applyTrackedReduction(
      "competencia_2",
      40,
      "Foi identificada baixa densidade argumentativa, com repertório sociocultural frágil, decorativo ou insuficientemente desenvolvido para sustentar a discussão.",
      "Use repertório sociocultural pertinente e desenvolva melhor a relação dele com o tema, evitando apenas citar autores, leis ou conceitos.",
    );
    applyTrackedReduction(
      "competencia_3",
      40,
      "A argumentação permaneceu genérica, com afirmações pouco desenvolvidas e explicação insuficiente de causas, consequências e exemplos concretos.",
      "Desenvolva melhor cada argumento, explicando mecanismos, impactos e exemplos concretos em vez de apenas afirmar o problema.",
    );
    applyTrackedReduction(
      "competencia_4",
      40,
      "A organização do texto não compensou a baixa densidade analítica, o que impediu uma progressão argumentativa mais consistente.",
      "Use a coesão para aprofundar o raciocínio, articulando melhor explicações, exemplos e desdobramentos dos argumentos.",
    );
    applyTrackedReduction(
      "competencia_5",
      40,
      "A proposta de intervenção não superou o nível genérico exigido para uma redação com baixa densidade argumentativa.",
      "Detalhe melhor agente, ação, meio e finalidade, conectando a proposta aos problemas discutidos no desenvolvimento.",
    );
  }

  recalculateFinalScore(processed);

  if (processed.nota_final === 1000 && !signals.isExceptionalEssay) {
    applyTrackedPenalty(
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

  if ((processed.nota_final ?? 0) > 960 && !signals.isExceptionalEssay && !hasHighQualityFoundation) {
    applyTrackedPenalty(
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

  if ((processed.nota_final ?? 0) > 920 && !signals.isExceptionalEssay && !hasHighQualityFoundation) {
    applyTrackedPenalty(
      signals.hasGenericArgumentation ? "competencia_3" : "competencia_5",
      160,
      "A redação apresentou bom desempenho global, mas ainda não atingiu o nível de excelência exigido para ultrapassar a faixa das redações boas.",
      "Para entrar na faixa de excelência, aprofunde mais a argumentação e detalhe melhor a proposta de intervenção, evitando generalizações.",
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

  if (process.env.NODE_ENV !== "production") {
    console.info("postProcessEvaluation debug", {
      beforeScores,
      afterScores: {
        competencia_1: processed.competencia_1?.nota ?? 0,
        competencia_2: processed.competencia_2?.nota ?? 0,
        competencia_3: processed.competencia_3?.nota ?? 0,
        competencia_4: processed.competencia_4?.nota ?? 0,
        competencia_5: processed.competencia_5?.nota ?? 0,
        nota_final: processed.nota_final ?? 0,
      },
      signals,
      penaltiesApplied,
    });
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

    const promptMestre = `Você é um corretor experiente de redações do ENEM. Avalie a redação com rigor, justiça e realismo, aproximando-se ao máximo de uma correção humana.

REGRAS GERAIS:
- use apenas as notas 0, 40, 80, 120, 160 e 200;
- não seja motivacional na atribuição da nota;
- não premie aparência de texto bom;
- texto organizado, conectivos e linguagem formal não garantem nota alta;
- não confunda estrutura pronta com qualidade argumentativa;
- não premie repertório coringa, decorativo ou apenas citado;
- não penalize em cascata outras competências apenas por erros gramaticais, exceto quando eles prejudicarem a compreensão;
- se houver dúvida entre duas faixas, escolha a menor.

PROCESSO DE CORREÇÃO:
1. Classifique internamente a redação como fraca, mediana, boa, muito boa ou excelente.
2. Verifique se o texto:
- explica causas e consequências;
- desenvolve argumentos em vez de só afirmar;
- usa repertório sociocultural pertinente e produtivo;
- apresenta proposta de intervenção detalhada e relacionada ao problema.
3. Se a redação for superficial, genérica ou pouco desenvolvida, reduza a nota.

FAIXAS DE REFERÊNCIA:
- fraca: 500–640;
- mediana: 680–800;
- boa: 820–900;
- muito boa: 920–960;
- excelente: 960–1000.

CALIBRAÇÃO:
- texto genérico tende a ficar em 500–680, salvo se houver estrutura e algum desenvolvimento relevante;
- redações superficiais não devem receber nota alta só porque parecem bem escritas;
- repertório só vale quando é pertinente, explicado e integrado ao argumento;
- argumentação forte exige desenvolvimento real de causas, consequências, mecanismos e impactos;
- proposta de intervenção forte exige agente, ação, meio/modo, finalidade e detalhamento;
- nota 1000 deve ser rara, mas possível.

CRITÉRIOS POR COMPETÊNCIA:
- Competência 1: avalie gramática, ortografia, concordância, regência, pontuação, clareza sintática e domínio da norma padrão.
- Competência 2: avalie compreensão do tema e uso de repertório sociocultural pertinente, produtivo e conectado à argumentação.
- Competência 3: avalie seleção, organização e desenvolvimento dos argumentos. Texto genérico, superficial ou repetitivo deve ser penalizado.
- Competência 4: avalie coesão e progressão textual. Não atribua nota máxima apenas por presença de conectivos.
- Competência 5: avalie a proposta de intervenção. Proposta vaga ou genérica não deve receber nota alta.

ORIENTAÇÕES DE RIGOR:
- repertório decorativo ou pouco explicado tende a ficar no máximo em 160 na Competência 2;
- argumentação superficial tende a ficar no máximo em 160 na Competência 3;
- coesão apenas funcional, repetitiva ou mecânica tende a ficar no máximo em 160 na Competência 4;
- proposta genérica tende a ficar no máximo em 160 na Competência 5;
- nota 200 em qualquer competência exige desempenho claramente acima da média;
- antes de atribuir nota final acima de 920, confirme repertório produtivo, argumentação consistente, boa coesão, intervenção detalhada e domínio linguístico sólido.

SUGESTÕES DE REESCRITA:
- selecione até 3 trechos reais da redação que precisam de melhoria;
- priorize argumento genérico, linguagem simples ou falta de precisão;
- mantenha o sentido original, mas reescreva com maior formalidade, especificidade e sofisticação;
- não invente ideias totalmente novas.

TEMA DA REDAÇÃO: "${normalizedTheme}"

SAÍDA:
- retorne apenas JSON puro;
- a nota_final deve ser a soma exata das 5 competências;
- use exatamente esta estrutura:

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
