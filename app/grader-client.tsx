"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CorrectionResponse,
  CorrectionResult,
  EssayHistoryItem,
  ImprovedRewriteResponse,
  MonthlyRankingView,
  SaveEssayResponse,
  UsageSnapshot,
} from "@/lib/essay-types";

type GraderClientProps = {
  initialHistory: EssayHistoryItem[];
  initialUsage: UsageSnapshot;
  currentRole: "student" | "teacher" | "admin";
  ranking: MonthlyRankingView;
};

const PRIMARY_GEMINI_MODEL = "gemini-3.1-flash-lite";

const THEME_SUGGESTIONS = [
  "Os desafios para combater a desinformação no Brasil",
  "Caminhos para reduzir a evasão escolar no ensino médio",
  "Os impactos do uso excessivo das redes sociais entre jovens",
];

const LOADING_MESSAGES = [
  "Analisando sua redação...",
  "Avaliando competências...",
  "Gerando feedback...",
];

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatDiff(value: number) {
  if (value > 0) {
    return `+${value}`;
  }

  return `${value}`;
}

function getPerformanceLevel(score: number) {
  if (score <= 600) {
    return "Básico";
  }

  if (score <= 800) {
    return "Intermediário";
  }

  if (score <= 900) {
    return "Avançado";
  }

  return "Excelente";
}

function getCorrectionLabel(role: GraderClientProps["currentRole"]) {
  if (role === "teacher") {
    return "Correções da conta nesta semana";
  }

  if (role === "admin") {
    return "Correções da conta";
  }

  return "Correções nesta semana";
}

function getStorageLabel(role: GraderClientProps["currentRole"]) {
  if (role === "student") {
    return "Redações salvas no histórico";
  }

  return "Histórico salvo";
}

function getCacheLabel(cacheSource?: EssayHistoryItem["cacheSource"]) {
  if (cacheSource === "duplicate_student") {
    return "cache do próprio aluno";
  }

  if (cacheSource === "duplicate_global") {
    return "cache global";
  }

  return "correção nova";
}

function getTrendLabel(history: EssayHistoryItem[]) {
  if (history.length < 2) {
    return "Você ainda não tem histórico suficiente para medir tendência.";
  }

  const [latest, previous] = history;
  const diff = latest.finalScore - previous.finalScore;

  if (diff > 0) {
    return `Sua última redação subiu ${diff} pontos em relação à anterior.`;
  }

  if (diff < 0) {
    return `Sua última redação caiu ${Math.abs(diff)} pontos em relação à anterior.`;
  }

  return "Sua última redação manteve a mesma pontuação da anterior.";
}

function hasModelFallback(aiModel?: string | null) {
  return !!aiModel && aiModel !== PRIMARY_GEMINI_MODEL;
}

function getCorrectionStatusMessages(result: CorrectionResponse) {
  const messages = ["CorreÃ§Ã£o concluÃ­da com sucesso"];

  if (result.cacheSource !== "fresh") {
    messages.push("CorreÃ§Ã£o recuperada do histÃ³rico/cache");
  }

  if (result.cacheSource === "fresh" && hasModelFallback(result.aiModel)) {
    messages.push("Usamos uma rota alternativa para concluir sua correÃ§Ã£o.");
  }

  return messages;
}

function normalizePlanText(text?: string) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,\s]+$/g, "");
}

function buildFallbackPriorityMessage(competency: number) {
  if (competency === 2) {
    return "Reforce seu repertÃ³rio com dados, exemplos ou referÃªncias mais especÃ­ficas.";
  }

  if (competency === 3) {
    return "Aprofunde melhor seus argumentos para explicar causas, efeitos e consequÃªncias.";
  }

  if (competency === 5) {
    return "Detalhe mais sua proposta de intervenÃ§Ã£o, sobretudo o meio e o efeito esperado.";
  }

  if (competency === 4) {
    return "Melhore a conexÃ£o entre as ideias para deixar o texto mais fluido.";
  }

  return "Revise a escrita para ganhar mais clareza, precisÃ£o e seguranÃ§a na linguagem.";
}

function buildRefinementPlan() {
  return [
    "Refine seu repertÃ³rio com referÃªncias ainda mais especÃ­ficas e bem conectadas ao tema.",
    "Aprofunde um pouco mais a anÃ¡lise dos argumentos para mostrar mais densidade crÃ­tica.",
    "Deixe a proposta de intervenÃ§Ã£o ainda mais detalhada para se aproximar da nota mÃ¡xima.",
  ];
}

function getImprovementPlan(result: CorrectionResponse) {
  const competencies = [1, 2, 3, 4, 5]
    .map((number) => {
      const key = `competencia_${number}` as keyof CorrectionResult;
      const data = result[key] as CorrectionResult["competencia_1"] | undefined;

      return {
        number,
        score: data?.nota ?? 0,
        improvement: normalizePlanText(data?.melhoria),
        diagnosis: normalizePlanText(data?.justificativa),
      };
    })
    .sort((a, b) => a.score - b.score);

  const allHighScores = competencies.every((competency) => competency.score >= 160);

  if (allHighScores) {
    return buildRefinementPlan();
  }

  return competencies
    .slice(0, 3)
    .map((competency) => {
      const sourceText = competency.improvement || competency.diagnosis;

      if (sourceText) {
        return sourceText;
      }

      return buildFallbackPriorityMessage(competency.number);
    })
    .filter(Boolean);
}

function ProgressChart({ history }: { history: EssayHistoryItem[] }) {
  const scores = history
    .slice()
    .reverse()
    .slice(-6)
    .map((essay) => essay.finalScore);

  if (scores.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        Salve pelo menos duas redações para visualizar sua evolução 📈
      </div>
    );
  }

  const width = 320;
  const height = 140;
  const maxScore = 1000;
  const stepX = width / Math.max(scores.length - 1, 1);
  const points = scores
    .map((score, index) => {
      const x = index * stepX;
      const y = height - (score / maxScore) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-semibold text-slate-700">
        Evolução das últimas notas
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-36 w-full overflow-visible"
        role="img"
        aria-label="Gráfico de evolução das notas"
      >
        {[200, 400, 600, 800, 1000].map((tick) => {
          const y = height - (tick / maxScore) * height;
          return (
            <g key={tick}>
              <line
                x1="0"
                y1={y}
                x2={width}
                y2={y}
                stroke="#e2e8f0"
                strokeDasharray="4 4"
              />
              <text x="0" y={Math.max(y - 4, 10)} fontSize="10" fill="#64748b">
                {tick}
              </text>
            </g>
          );
        })}
        <polyline
          fill="none"
          stroke="#4f46e5"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
        {scores.map((score, index) => {
          const x = index * stepX;
          const y = height - (score / maxScore) * height;
          return <circle key={`${score}-${index}`} cx={x} cy={y} r="4" fill="#312e81" />;
        })}
      </svg>
    </div>
  );
}

export function GraderClient({
  initialHistory,
  initialUsage,
  currentRole,
  ranking,
}: GraderClientProps) {
  const [tema, setTema] = useState("");
  const [redacao, setRedacao] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [history, setHistory] = useState(initialHistory);
  const [usage, setUsage] = useState(initialUsage);
  const [resultado, setResultado] = useState<CorrectionResponse | null>(null);
  const [improvedEssay, setImprovedEssay] = useState<string | null>(null);
  const [improvedEssayModel, setImprovedEssayModel] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "sucesso" | "erro";
    texto: string;
  } | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const boletimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingStep((current) => (current + 1) % LOADING_MESSAGES.length);
    }, 1200);

    return () => window.clearInterval(interval);
  }, [loading]);

  const averageScore = useMemo(() => {
    if (history.length === 0) {
      return null;
    }

    const total = history.reduce((sum, essay) => sum + essay.finalScore, 0);
    return Math.round(total / history.length);
  }, [history]);

  const bestScore = useMemo(() => {
    if (history.length === 0) {
      return null;
    }

    return Math.max(...history.map((essay) => essay.finalScore));
  }, [history]);

  const improvementPlan = useMemo(
    () => (resultado ? getImprovementPlan(resultado) : []),
    [resultado],
  );

  const currentFingerprint = `${tema.trim()}::${redacao.trim()}::${resultado?.nota_final ?? "sem-nota"}`;
  const canSaveCurrentEssay =
    !!resultado &&
    !!tema.trim() &&
    !!redacao.trim() &&
    savedFingerprint !== currentFingerprint &&
    usage.storedEssaysCount < usage.storedEssaysLimit;

  async function corrigirRedacao() {
    if (!tema.trim()) {
      setAviso({
        tipo: "erro",
        texto: "Informe o tema da redação antes de solicitar a correção.",
      });
      return;
    }

    if (!redacao.trim()) {
      setAviso({
        tipo: "erro",
        texto: "Por favor, cole uma redação antes de solicitar a correção.",
      });
      return;
    }

    setLoading(true);
    setResultado(null);
    setImprovedEssay(null);
    setImprovedEssayModel(null);
    setAviso(null);

    try {
      const resposta = await fetch("/api/corrigir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: redacao,
          tema: tema.trim(),
        }),
      });

      const dados = (await resposta.json()) as CorrectionResponse;

      if (!resposta.ok) {
        if (dados.usage) {
          setUsage(dados.usage);
        }
        throw new Error(dados.error ?? "Erro ao processar a correção.");
      }

      setResultado(dados);
      if (dados.usage) {
        setUsage(dados.usage);
      }
      setSavedFingerprint(null);
      setAviso({
        tipo: "sucesso",
        texto: "Correção concluída. Se quiser, agora você pode salvar a redação no histórico.",
      });

      window.setTimeout(() => {
        boletimRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    } catch (error) {
      setAviso({
        tipo: "erro",
        texto:
          error instanceof Error
            ? error.message
            : "Nosso sistema está recebendo muitas redações agora. Aguarde um pouco e tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function salvarRedacao() {
    if (!tema.trim()) {
      setAviso({
        tipo: "erro",
        texto: "Preencha o tema para salvar a redação corretamente no histórico.",
      });
      return;
    }

    if (!resultado) {
      setAviso({
        tipo: "erro",
        texto: "Faça a correção da redação antes de salvá-la.",
      });
      return;
    }

    setSaving(true);
    setAviso(null);

    try {
      const resposta = await fetch("/api/redacoes/salvar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: redacao,
          tema: tema.trim(),
          avaliacao: resultado,
          aiModel: resultado.aiModel ?? null,
          cacheSource: resultado.cacheSource ?? "fresh",
        }),
      });

      const dados = (await resposta.json()) as SaveEssayResponse;

      if (!resposta.ok) {
        if (dados.usage) {
          setUsage(dados.usage);
        }
        throw new Error(dados.error ?? "Não foi possível salvar a redação.");
      }

      if (dados.savedEssay) {
        const savedEssay = dados.savedEssay;
        setHistory((current) => [savedEssay, ...current].slice(0, 20));
      }
      if (dados.usage) {
        setUsage(dados.usage);
      }
      setSavedFingerprint(currentFingerprint);
      setAviso({
        tipo: "sucesso",
        texto: "Redação salva com sucesso no seu histórico.",
      });
    } catch (error) {
      setAviso({
        tipo: "erro",
        texto:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a redação agora.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function gerarVersaoMelhorada() {
    if (!tema.trim() || !redacao.trim() || !resultado) {
      setAviso({
        tipo: "erro",
        texto: "FaÃ§a a correÃ§Ã£o da redaÃ§Ã£o antes de gerar a versÃ£o melhorada.",
      });
      return;
    }

    setRewriteLoading(true);
    setAviso(null);

    try {
      const resposta = await fetch("/api/reescrever", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          texto: redacao,
          tema: tema.trim(),
          avaliacao: resultado,
        }),
      });

      const dados = (await resposta.json()) as ImprovedRewriteResponse;

      if (!resposta.ok) {
        throw new Error(dados.error ?? "NÃ£o foi possÃ­vel gerar a versÃ£o melhorada.");
      }

      setImprovedEssay(dados.rewrittenEssay ?? null);
      setImprovedEssayModel(dados.aiModel ?? null);
      setAviso({
        tipo: "sucesso",
        texto: "Sua versÃ£o melhorada foi gerada com base no feedback da correÃ§Ã£o.",
      });
    } catch (error) {
      setAviso({
        tipo: "erro",
        texto:
          error instanceof Error
            ? error.message
            : "NÃ£o foi possÃ­vel gerar a versÃ£o melhorada agora.",
      });
    } finally {
      setRewriteLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-500">
            {getCorrectionLabel(currentRole)}
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {usage.weeklyCorrectionsUsed}/{usage.weeklyCorrectionsLimit}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Limite semanal de correções da conta.
          </p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-500">
            {getStorageLabel(currentRole)}
          </div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {usage.storedEssaysCount}/{usage.storedEssaysLimit}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            As redações só entram no histórico quando você salva manualmente.
          </p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-500">Média atual</div>
          <div className="mt-2 text-3xl font-black text-slate-900">
            {averageScore ?? "--"}
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {getTrendLabel(history)}
          </p>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold text-slate-500">Melhor nota</div>
          <div className="mt-2 text-3xl font-black text-slate-900">{bestScore ?? "--"}</div>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Seu melhor desempenho salvo até agora.
          </p>
        </div>
      </div>

      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-8 space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="tema"
              className="block text-lg font-semibold text-slate-900"
            >
              Tema da redação <span className="text-rose-500">*</span>
            </label>
            <p className="text-sm text-slate-500">
              Informar o tema ajuda a IA a avaliar melhor a Competência 2.
            </p>
          </div>
          <input
            type="text"
            id="tema"
            className="w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-lg text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            placeholder="Ex: Os desafios para combater a desinformação no Brasil"
            value={tema}
            onChange={(event) => setTema(event.target.value)}
            disabled={loading || saving}
          />
          <div className="flex flex-wrap gap-2">
            {THEME_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setTema(suggestion)}
                disabled={loading || saving}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between gap-4">
          <label
            htmlFor="redacao"
            className="block text-lg font-semibold text-slate-900"
          >
            Texto da redação
          </label>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-500">
            Máx. 30 linhas recomendadas
          </span>
        </div>

        <textarea
          id="redacao"
          rows={14}
          className="w-full resize-y rounded-2xl border border-slate-300 bg-slate-50 p-5 text-lg leading-relaxed text-slate-700 shadow-inner outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
          placeholder="Digite ou cole aqui sua redação dissertativo-argumentativa..."
          value={redacao}
          onChange={(event) => setRedacao(event.target.value)}
          disabled={loading || saving}
        />

        <div className="mt-6 space-y-4">
          <button
            onClick={corrigirRedacao}
            disabled={loading || saving}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg transition ${
              loading
                ? "cursor-not-allowed bg-indigo-400"
                : "bg-indigo-600 hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-indigo-200"
            }`}
          >
            {loading ? LOADING_MESSAGES[loadingStep] : "Corrigir redação"}
          </button>

          {loading ? (
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4 text-sm font-medium text-indigo-800">
              Estamos avaliando sua redação em etapas para entregar um feedback mais claro e detalhado.
            </div>
          ) : null}

          {resultado ? (
            <button
              onClick={salvarRedacao}
              disabled={!canSaveCurrentEssay || saving}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg transition ${
                !canSaveCurrentEssay || saving
                  ? "cursor-not-allowed bg-emerald-300"
                  : "bg-emerald-600 hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-emerald-200"
              }`}
            >
              {saving ? "Salvando..." : "Salvar redação no histórico"}
            </button>
          ) : null}

          {resultado ? (
            <button
              onClick={gerarVersaoMelhorada}
              disabled={rewriteLoading || loading || saving}
              className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold transition ${
                rewriteLoading || loading || saving
                  ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
                  : "border border-indigo-200 bg-white text-indigo-700 hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-50"
              }`}
            >
              {rewriteLoading ? "Gerando versÃ£o melhorada..." : "Gerar versÃ£o melhorada"}
            </button>
          ) : null}
        </div>

        {aviso ? (
          <div
            className={`mt-6 rounded-2xl border p-4 text-center text-base font-medium ${
              aviso.tipo === "sucesso"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-amber-200 bg-amber-50 text-amber-800"
            }`}
          >
            {aviso.texto}
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <h3 className="text-2xl font-bold text-slate-900">
              Histórico de redações salvas
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Revise seus envios e acompanhe a consistência das suas notas.
            </p>
          </div>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Você ainda não salvou nenhuma redação. Corrija e salve para acompanhar sua evolução.
            </div>
          ) : (
            <div className="space-y-4">
              {history.map((essay) => (
                <article
                  key={essay.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-900">{essay.theme}</h4>
                      <p className="mt-1 text-sm text-slate-500">
                        Salva em {formatDate(essay.submittedAt)} • {essay.wordCount} palavras
                      </p>
                    </div>
                    <div className="rounded-full bg-indigo-100 px-4 py-2 text-sm font-bold text-indigo-800">
                      {essay.finalScore} pontos
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-200 px-3 py-1 font-semibold text-slate-700">
                      {essay.aiModel ?? "Modelo não informado"}
                    </span>
                    <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">
                      {getCacheLabel(essay.cacheSource)}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {essay.summary}
                  </p>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-bold text-slate-900">Ranking do mês</h3>
                <p className="mt-1 text-sm text-slate-500 capitalize">{ranking.monthLabel}</p>
              </div>
              {ranking.currentUserPosition ? (
                <div className="rounded-full bg-indigo-100 px-4 py-2 text-sm font-semibold text-indigo-800">
                  Sua posição: #{ranking.currentUserPosition}
                </div>
              ) : null}
            </div>

            {ranking.entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Ainda não há redações corrigidas neste mês para montar o ranking.
              </div>
            ) : (
              <div className="space-y-3">
                {ranking.entries.map((entry) => (
                  <article
                    key={`${entry.studentId}-${entry.position}`}
                    className={`rounded-2xl border p-4 ${
                      entry.isCurrentUser
                        ? "border-indigo-200 bg-indigo-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                          #{entry.position}
                        </div>
                        <h4 className="mt-1 font-semibold text-slate-900">
                          {entry.displayName}
                        </h4>
                        {(currentRole === "teacher" || currentRole === "admin") &&
                        entry.classGroup ? (
                          <p className="mt-1 text-sm text-slate-500">
                            Turma: {entry.classGroup}
                          </p>
                        ) : null}
                        {currentRole !== "student" ? (
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            Tema: {entry.theme}
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-full bg-amber-100 px-4 py-2 text-sm font-bold text-amber-800">
                        {entry.bestScore} pontos
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-2xl font-bold text-slate-900">Progressão</h3>
            <ProgressChart history={history} />
          </div>

          <div ref={boletimRef}>
            {resultado?.nota_final !== undefined ? (
              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 bg-slate-50 p-8 text-center">
                  <div className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                    Resultado da correção
                  </div>
                  <h2 className="mb-2 text-xl font-bold uppercase tracking-[0.25em] text-slate-500">
                    Nota final
                  </h2>
                  <div className="rounded-[32px] bg-slate-950 px-6 py-8 shadow-inner">
                    <div className="bg-gradient-to-r from-indigo-300 via-white to-indigo-300 bg-clip-text text-7xl font-black text-transparent">
                      {resultado.nota_final}
                    </div>
                    <div className="mt-4 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800">
                      Nível: {getPerformanceLevel(resultado.nota_final)}
                    </div>
                  </div>
                  {resultado.resumo_geral ? (
                    <p className="mt-6 inline-block max-w-3xl rounded-2xl border border-slate-100 bg-white p-6 text-left text-lg italic leading-relaxed text-slate-700 shadow-sm">
                      &quot;{resultado.resumo_geral}&quot;
                    </p>
                  ) : null}
                </div>

                <div className="space-y-8 p-8">
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                        <svg
                          viewBox="0 0 20 20"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          aria-hidden="true"
                        >
                          <path d="M4.5 10.5 8 14l7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div className="space-y-1.5">
                        {getCorrectionStatusMessages(resultado).map((message) => (
                          <p key={message} className="font-medium leading-6">
                            {message}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {currentRole === "admin" ? (
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                      {resultado.aiModel ?? "Modelo não informado"}
                    </span>
                    ) : null}
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      {getCacheLabel(resultado.cacheSource)}
                    </span>
                  </div>

                  <section className="space-y-6">
                    <div className="space-y-2 border-b border-slate-200 pb-4">
                      <h3 className="text-2xl font-bold text-slate-900">
                        Competências
                      </h3>
                      <p className="text-sm text-slate-500">
                        Veja sua nota em cada critério do ENEM, com diagnóstico e orientação prática.
                      </p>
                    </div>

                    <div className="space-y-5">
                      {[1, 2, 3, 4, 5].map((num) => {
                        const comp = resultado[
                          `competencia_${num}` as keyof CorrectionResult
                        ] as CorrectionResult["competencia_1"] | undefined;

                        if (!comp) {
                          return null;
                        }

                        return (
                          <div
                            key={num}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm"
                          >
                            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <h4 className="text-lg font-bold text-slate-900">
                                Competência {num}
                              </h4>
                              <span className="rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-bold text-indigo-800">
                                {comp.nota} / 200 pts
                              </span>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="mb-2 text-sm font-semibold text-slate-900">
                                  Diagnóstico
                                </div>
                                <p className="text-sm leading-6 text-slate-600">
                                  {comp.justificativa}
                                </p>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="mb-2 text-sm font-semibold text-slate-900">
                                  Como melhorar
                                </div>
                                <p className="text-sm leading-6 text-slate-600">
                                  {comp.melhoria}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {improvementPlan.length > 0 ? (
                    <section className="space-y-4 border-t border-slate-200 pt-8">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-slate-900">
                          Plano de melhoria
                        </h3>
                        <p className="text-sm text-slate-500">
                          Priorize estes ajustes na sua prÃ³xima versÃ£o para evoluir com mais clareza.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
                        <div className="space-y-3">
                          {improvementPlan.slice(0, 3).map((item, index) => (
                            <div
                              key={`${index}-${item}`}
                              className="rounded-xl border border-emerald-100 bg-white/80 p-4 text-sm leading-6 text-slate-700"
                            >
                              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-xs font-bold text-white">
                                {index + 1}
                              </span>
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {improvedEssay ? (
                    <section className="space-y-4 border-t border-slate-200 pt-8">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <h3 className="text-2xl font-bold text-slate-900">
                            VersÃ£o melhorada da sua redaÃ§Ã£o
                          </h3>
                          <p className="text-sm text-slate-500">
                            Esta reescrita preserva sua ideia central e aplica os principais ajustes do feedback.
                          </p>
                        </div>
                        {currentRole === "admin" && improvedEssayModel ? (
                          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                            {improvedEssayModel}
                          </span>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-6">
                        <p className="whitespace-pre-line text-sm leading-7 text-slate-700">
                          {improvedEssay}
                        </p>
                      </div>
                    </section>
                  ) : null}

                  {resultado.comparacao ? (
                    <section className="space-y-4 border-t border-slate-200 pt-8">
                      <h3 className="text-2xl font-bold text-slate-900">
                        Comparação com a versão anterior
                      </h3>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Nota anterior
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">
                            {resultado.comparacao.previousFinalScore}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Nota atual
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">
                            {resultado.comparacao.currentFinalScore}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Variação
                          </div>
                          <div
                            className={`mt-2 text-3xl font-black ${
                              resultado.comparacao.finalScoreDiff > 0
                                ? "text-emerald-700"
                                : resultado.comparacao.finalScoreDiff < 0
                                  ? "text-rose-700"
                                  : "text-slate-900"
                            }`}
                          >
                            {formatDiff(resultado.comparacao.finalScoreDiff)} pontos
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                        <div className="mb-3 text-sm font-semibold text-slate-700">
                          Evolução por competência
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          {resultado.comparacao.competencyDiffs.map((diff, index) => (
                            <div
                              key={`comparison-${index + 1}`}
                              className="rounded-xl border border-slate-200 bg-white p-4"
                            >
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                C{index + 1}
                              </div>
                              <div className="mt-2 text-sm text-slate-600">
                                {resultado.comparacao?.previousCompetencies[index]} →{" "}
                                {resultado.comparacao?.currentCompetencies[index]}
                              </div>
                              <div
                                className={`mt-2 text-lg font-bold ${
                                  diff > 0
                                    ? "text-emerald-700"
                                    : diff < 0
                                      ? "text-rose-700"
                                      : "text-slate-700"
                                }`}
                              >
                                {formatDiff(diff)} pts
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm leading-7 text-slate-700">
                        <span className="font-semibold text-slate-900">
                          Resumo da evolução:
                        </span>{" "}
                        {resultado.comparacao.summary}
                      </div>
                    </section>
                  ) : null}

                  {resultado.sugestoes_reescrita && resultado.sugestoes_reescrita.length > 0 ? (
                    <section className="space-y-4 border-t border-slate-200 pt-8">
                      <div className="space-y-2">
                        <h3 className="text-2xl font-bold text-slate-900">
                          Sugestões de reescrita
                        </h3>
                        <p className="text-sm text-slate-500">
                          Exemplos práticos para elevar clareza, especificidade e sofisticação.
                        </p>
                      </div>
                      <div className="space-y-4">
                        {resultado.sugestoes_reescrita.map((sugestao, index) => (
                          <article
                            key={`${sugestao.trecho_original}-${index}`}
                            className="rounded-2xl border border-slate-200 bg-slate-50 p-5"
                          >
                            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Trecho {index + 1}
                            </div>
                            <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 p-4">
                              <div className="text-sm font-semibold text-rose-700">Original</div>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {sugestao.trecho_original}
                              </p>
                            </div>
                            <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                              <div className="text-sm font-semibold text-emerald-700">
                                Reescrita sugerida
                              </div>
                              <p className="mt-2 text-sm leading-6 text-slate-700">
                                {sugestao.sugestao_reescrita}
                              </p>
                            </div>
                            <div className="mt-3 text-sm leading-6 text-slate-600">
                              <span className="font-semibold text-slate-800">Por que melhorar:</span>{" "}
                              {sugestao.motivo}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
