import { NextResponse } from "next/server";
import type { UserProfile } from "@/lib/auth";
import type { CacheSource, CorrectionResult, SaveEssayResponse } from "@/lib/essay-types";
import { createClient } from "@/lib/supabase/server";
import {
  buildEssayHash,
  getUsageSnapshot,
  saveCorrectionResult,
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

function getStorageLimitMessage(role: UserProfile["role"]) {
  if (role === "student") {
    return "Você atingiu o limite de 20 redações salvas. Exclua uma antiga antes de salvar outra.";
  }

  return "A conta atual atingiu o limite configurado de redações salvas.";
}

function inferAiProvider(aiModel?: string | null) {
  if (!aiModel) {
    return "manual-save";
  }

  if (aiModel.startsWith("openai:") || aiModel.startsWith("gpt-")) {
    return "openai";
  }

  if (aiModel.startsWith("gemini-")) {
    return "google-gemini";
  }

  return "external-ai";
}

export async function POST(request: Request) {
  try {
    const { supabase, session, profile } = await getCurrentProfile();

    if (!session?.user || !profile) {
      return NextResponse.json(
        { error: "Você precisa estar autenticado para salvar a redação." } satisfies SaveEssayResponse,
        { status: 401 },
      );
    }

    if (!profile.is_active) {
      return NextResponse.json(
        { error: "Sua conta está inativa no momento." } satisfies SaveEssayResponse,
        { status: 403 },
      );
    }

    const {
      texto,
      tema,
      avaliacao,
      aiModel,
      cacheSource,
    } = (await request.json()) as {
      texto?: string;
      tema?: string;
      avaliacao?: CorrectionResult;
      aiModel?: string | null;
      cacheSource?: CacheSource;
    };

    const normalizedTheme = String(tema ?? "").trim();
    const normalizedText = String(texto ?? "").trim();

    if (!normalizedText || !avaliacao?.nota_final) {
      return NextResponse.json(
        { error: "Faça a correção da redação antes de salvar." } satisfies SaveEssayResponse,
        { status: 400 },
      );
    }

    if (!normalizedTheme) {
      return NextResponse.json(
        { error: "Informe o tema da redação antes de salvar no histórico." } satisfies SaveEssayResponse,
        { status: 400 },
      );
    }

    const usageBefore = await getUsageSnapshot(supabase, profile);

    if (usageBefore.storedEssaysCount >= usageBefore.storedEssaysLimit) {
      return NextResponse.json(
        {
          error: getStorageLimitMessage(profile.role),
          usage: usageBefore,
        } satisfies SaveEssayResponse,
        { status: 403 },
      );
    }

    const savedEssay = await saveCorrectionResult({
      supabase,
      profile,
      text: normalizedText,
      theme: normalizedTheme,
      result: avaliacao,
      contentHash: buildEssayHash(normalizedText, normalizedTheme),
      aiProvider: inferAiProvider(aiModel),
      aiModel: aiModel ?? null,
      cacheSource: cacheSource ?? "fresh",
    });

    const usageAfter = await getUsageSnapshot(supabase, profile);

    return NextResponse.json({
      savedEssay,
      usage: usageAfter,
    } satisfies SaveEssayResponse);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível salvar a redação agora. Tente novamente." } satisfies SaveEssayResponse,
      { status: 500 },
    );
  }
}
