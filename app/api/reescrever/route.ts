import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import type { UserProfile } from "@/lib/auth";
import type {
  CorrectionResult,
  ImprovedRewriteResponse,
} from "@/lib/essay-types";
import { createClient } from "@/lib/supabase/server";
import { logUsageEvent } from "@/lib/essays";

const GEMINI_MODELOS_PARA_TESTAR = [
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash-lite",
  "gemini-3-flash",
  "gemini-2.5-flash",
] as const;

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

function getStartOfDayInSaoPaulo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}T00:00:00-03:00`;
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

async function gerarComFallback(prompt: string, chavesDisponiveis: string[]) {
  let lastRetryableError: unknown = null;

  for (const key of chavesDisponiveis) {
    const genAI = new GoogleGenerativeAI(key);

    for (const modelName of GEMINI_MODELOS_PARA_TESTAR) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent(prompt);
        const rewrittenEssay = result.response.text().trim();

        console.info("Gemini rewrite model selected", { model: modelName });

        return {
          rewrittenEssay,
          selectedModel: modelName,
        };
      } catch (error) {
        const retryable = isRetryableGeminiError(error);

        console.warn("Gemini rewrite attempt failed", {
          model: modelName,
          retryable,
          error,
        });

        if (!retryable) {
          throw error;
        }

        lastRetryableError = error;
      }
    }
  }

  throw new Error(
    "No momento nÃ£o conseguimos gerar a versÃ£o melhorada. Tente novamente mais tarde.",
    {
      cause: lastRetryableError ?? undefined,
    },
  );
}

function buildFeedbackSummary(avaliacao: CorrectionResult) {
  return [1, 2, 3, 4, 5]
    .map((number) => {
      const key = `competencia_${number}` as keyof CorrectionResult;
      const competency = avaliacao[key] as CorrectionResult["competencia_1"] | undefined;

      if (!competency) {
        return "";
      }

      return [
        `CompetÃªncia ${number} - nota ${competency.nota}.`,
        `DiagnÃ³stico: ${competency.justificativa}`,
        `Como melhorar: ${competency.melhoria}`,
      ].join(" ");
    })
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request) {
  try {
    const { supabase, session, profile } = await getCurrentProfile();

    if (!session?.user || !profile) {
      return NextResponse.json(
        { error: "VocÃª precisa estar autenticado para usar a versÃ£o melhorada." } satisfies ImprovedRewriteResponse,
        { status: 401 },
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        { error: "Sua conta estÃ¡ inativa no momento." } satisfies ImprovedRewriteResponse,
        { status: 403 },
      );
    }

    const {
      texto,
      tema,
      avaliacao,
    } = (await request.json()) as {
      texto?: string;
      tema?: string;
      avaliacao?: CorrectionResult;
    };

    const normalizedText = String(texto ?? "").trim();
    const normalizedTheme = String(tema ?? "").trim();

    if (!normalizedText || !normalizedTheme || !avaliacao?.nota_final) {
      return NextResponse.json(
        { error: "FaÃ§a uma correÃ§Ã£o vÃ¡lida antes de gerar a versÃ£o melhorada." } satisfies ImprovedRewriteResponse,
        { status: 400 },
      );
    }

    const { count: rewritesToday, error: rewritesError } = await supabase
      .from("usage_events")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", profile.id)
      .eq("event_type", "correction_requested")
      .contains("metadata", { feature: "improved_rewrite" })
      .gte("created_at", getStartOfDayInSaoPaulo());

    if (rewritesError) {
      throw new Error("NÃ£o foi possÃ­vel verificar o limite diÃ¡rio de reescrita.");
    }

    if ((rewritesToday ?? 0) >= 1) {
      return NextResponse.json(
        { error: "VocÃª jÃ¡ gerou uma versÃ£o melhorada hoje. Tente novamente amanhÃ£." } satisfies ImprovedRewriteResponse,
        { status: 403 },
      );
    }

    const chavesDisponiveis = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3,
    ].filter(Boolean) as string[];

    if (chavesDisponiveis.length === 0) {
      throw new Error("Nenhuma chave de API configurada no ambiente.");
    }

    const sugestoesReescrita = (avaliacao.sugestoes_reescrita ?? [])
      .map(
        (suggestion, index) =>
          `${index + 1}. Trecho original: "${suggestion.trecho_original}". SugestÃ£o: "${suggestion.sugestao_reescrita}". Motivo: ${suggestion.motivo}`,
      )
      .join("\n");

    const prompt = `VocÃª vai reescrever uma redaÃ§Ã£o do ENEM do prÃ³prio aluno.

TEMA ORIGINAL: "${normalizedTheme}"

REGRAS OBRIGATÃ“RIAS:
- mantenha o mesmo tema;
- preserve a ideia central, a tese e a linha argumentativa do aluno;
- nÃ£o invente uma redaÃ§Ã£o totalmente diferente;
- melhore coesÃ£o, repertÃ³rio e proposta de intervenÃ§Ã£o;
- mantenha o texto em formato de redaÃ§Ã£o dissertativo-argumentativa;
- entregue apenas a nova redaÃ§Ã£o completa, sem tÃ­tulos, sem explicaÃ§Ãµes e sem bullets.

REDAÃ‡ÃƒO ORIGINAL:
"${normalizedText}"

FEEDBACK DA CORREÃ‡ÃƒO:
${buildFeedbackSummary(avaliacao)}

SUGESTÃ•ES DE REESCRITA JÃ IDENTIFICADAS:
${sugestoesReescrita || "Nenhuma sugestÃ£o adicional disponÃ­vel."}

Agora produza uma versÃ£o melhorada da mesma redaÃ§Ã£o, mais clara, mais coesa e mais forte argumentativamente, sem fugir da proposta original do aluno.`;

    const { rewrittenEssay, selectedModel } = await gerarComFallback(
      prompt,
      chavesDisponiveis,
    );

    await logUsageEvent({
      supabase,
      profileId: profile.id,
      eventType: "correction_requested",
      metadata: {
        feature: "improved_rewrite",
        theme: normalizedTheme,
        ai_model: selectedModel,
      },
    });

    return NextResponse.json({
      rewrittenEssay,
      aiModel: selectedModel,
    } satisfies ImprovedRewriteResponse);
  } catch (error) {
    console.error("reescrever route failed", error);

    if (
      error instanceof Error &&
      error.message === "No momento nÃ£o conseguimos gerar a versÃ£o melhorada. Tente novamente mais tarde."
    ) {
      return NextResponse.json({ error: error.message } satisfies ImprovedRewriteResponse, {
        status: 503,
      });
    }

    return NextResponse.json(
      { error: "NÃ£o foi possÃ­vel gerar a versÃ£o melhorada agora. Tente novamente." } satisfies ImprovedRewriteResponse,
      { status: 500 },
    );
  }
}
