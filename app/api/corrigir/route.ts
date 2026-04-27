import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import type { UserProfile } from "@/lib/auth";
import type { CacheSource, CorrectionResponse, CorrectionResult } from "@/lib/essay-types";
import { createClient } from "@/lib/supabase/server";
import {
  buildEssayHash,
  findCachedCorrection,
  getUsageSnapshot,
  logUsageEvent,
  saveCorrectionFromCache,
} from "@/lib/essays";

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
    const normalizedTheme = String(tema ?? "").trim() || "Tema livre";
    const normalizedText = String(texto ?? "").trim();
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

      return NextResponse.json(
        buildCorrectionPayload(
          cachedCorrection.result,
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

    if (chavesDisponiveis.length === 0) {
      throw new Error("Nenhuma chave de API configurada no ambiente.");
    }

    const promptMestre = `Você é um corretor SÊNIOR da banca do ENEM (INEP). Sua missão é ser JUSTO E IMPARCIAL.

TEMA DA REDAÇÃO: "${normalizedTheme}"

1. REGRA DE OURO:
Se o aluno demonstra vocabulário sofisticado, usa citações culturais e conecta argumentos com fluidez, valorize isso. Nesses casos, releve até 2 desvios gramaticais leves na C1 e valide o repertório da C2 como produtivo se houver conexão lógica. Se o texto é de alto nível, a nota final deve refletir isso.

2. DETECTOR DE REPERTÓRIO CURINGA:
- Se o texto focar apenas em filosofia ou história antiga e não trouxer dados, leis brasileiras atuais ou exemplos práticos da realidade do Brasil hoje, a nota da C2 e C3 deve ter teto de 120 ou 160.
- Se a citação for jogada sem explicação, é repertório curinga: nota 120.
- Se a citação for explicada e conectada ao tema, é repertório produtivo: nota 200.

3. MATEMÁTICA DA CONCLUSÃO:
- Conte 5 elementos: Agente, Ação, Meio/Modo, Efeito e Detalhamento.
- Cada elemento vale 40 pontos.
- Considere explicações sobre o papel do órgão como detalhamento válido.

4. GRADE OFICIAL:
- C1 (Gramática): 0, 40, 80, 120, 160, 200
- C2 (Repertório): 0, 40, 80, 120, 160, 200
- C3 (Coerência): 0, 40, 80, 120, 160, 200
- C4 (Coesão): 0, 40, 80, 120, 160, 200
- C5 (Intervenção): 0, 40, 80, 120, 160, 200

IMPORTANTE:
- A nota_final deve ser a soma exata das 5 competências.
- Retorne ESTRITAMENTE um objeto JSON puro, sem texto fora do JSON.

{
  "competencia_1": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_2": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_3": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_4": { "nota": 0, "justificativa": "", "melhoria": "" },
  "competencia_5": { "nota": 0, "justificativa": "", "melhoria": "" },
  "nota_final": 0,
  "resumo_geral": ""
}

REDAÇÃO PARA AVALIAR: "${normalizedText}"`;

    const modelosParaTestar = [
      "gemini-2.5-pro",
      "gemini-2.5-flash",
      "gemini-2.0-flash",
    ];

    let rawResponse = "";
    let selectedModel: string | null = null;
    let sucesso = false;

    for (const key of chavesDisponiveis) {
      if (sucesso) {
        break;
      }

      const genAI = new GoogleGenerativeAI(key as string);

      for (const modelName of modelosParaTestar) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(promptMestre);
          rawResponse = result.response.text();
          selectedModel = modelName;
          sucesso = true;
          break;
        } catch {
          continue;
        }
      }
    }

    if (!sucesso) {
      throw new Error("Limite de API excedido em todas as chaves.");
    }

    const startIdx = rawResponse.indexOf("{");
    const endIdx = rawResponse.lastIndexOf("}") + 1;

    if (startIdx < 0 || endIdx <= startIdx) {
      throw new Error("A IA retornou uma resposta fora do formato esperado.");
    }

    const jsonString = rawResponse.substring(startIdx, endIdx);
    const avaliacao = JSON.parse(jsonString) as CorrectionResult;

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
      buildCorrectionPayload(avaliacao, selectedModel, "fresh", usageAfter),
    );
  } catch {
    return NextResponse.json(
      { error: "Ocorreu um erro ao processar sua nota. Tente novamente em 2 minutos." },
      { status: 500 },
    );
  }
}
