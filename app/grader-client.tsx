"use client";

import { useMemo, useRef, useState } from "react";
import type {
  CorrectionResponse,
  CorrectionResult,
  EssayHistoryItem,
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

const THEME_SUGGESTIONS = [
  "Os desafios para combater a desinformação no Brasil",
  "Caminhos para reduzir a evasão escolar no ensino médio",
  "Os impactos do uso excessivo das redes sociais entre jovens",
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
    return "Ainda não há histórico suficiente para medir tendência.";
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

function ProgressChart({ history }: { history: EssayHistoryItem[] }) {
  const scores = history
    .slice()
    .reverse()
    .slice(-6)
    .map((essay) => essay.finalScore);

  if (scores.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        Assim que houver pelo menos duas redações salvas, o gráfico de evolução aparece aqui.
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
  const [history, setHistory] = useState(initialHistory);
  const [usage, setUsage] = useState(initialUsage);
  const [resultado, setResultado] = useState<CorrectionResponse | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "sucesso" | "erro";
    texto: string;
  } | null>(null);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const boletimRef = useRef<HTMLDivElement>(null);

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

      setTimeout(() => {
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
        setHistory((current) => [dados.savedEssay!, ...current].slice(0, 20));
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
        <div className="mb-6">
          <label
            htmlFor="tema"
            className="mb-2 block text-lg font-semibold text-slate-800"
          >
            Qual é o tema da redação?
          </label>
          <input
            type="text"
            id="tema"
            className="w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-lg text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            placeholder="Ex.: Os desafios para combater a desinformação no Brasil"
            value={tema}
            onChange={(event) => setTema(event.target.value)}
            disabled={loading || saving}
          />
          <div className="mt-3 flex flex-wrap gap-2">
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
            className="block text-lg font-semibold text-slate-800"
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

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={corrigirRedacao}
            disabled={loading || saving}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg transition ${
              loading
                ? "cursor-not-allowed bg-indigo-400"
                : "bg-indigo-600 hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-indigo-200"
            }`}
          >
            {loading ? "Processando avaliação..." : "Solicitar correção"}
          </button>

          <button
            onClick={salvarRedacao}
            disabled={!canSaveCurrentEssay || loading || saving}
            className={`flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg transition ${
              !canSaveCurrentEssay || saving || loading
                ? "cursor-not-allowed bg-emerald-300"
                : "bg-emerald-600 hover:-translate-y-0.5 hover:bg-emerald-700 hover:shadow-emerald-200"
            }`}
          >
            {saving ? "Salvando..." : "Salvar redação no histórico"}
          </button>
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
          <h3 className="mb-4 text-2xl font-bold text-slate-900">
            Histórico de redações salvas
          </h3>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Suas redações só aparecem aqui quando você decide salvá-las manualmente.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((essay) => (
                <article
                  key={essay.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
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
                  <h2 className="mb-2 text-xl font-bold uppercase tracking-[0.25em] text-slate-500">
                    Nota final
                  </h2>
                  <div className="bg-gradient-to-r from-indigo-600 to-indigo-900 bg-clip-text text-7xl font-black text-transparent">
                    {resultado.nota_final}
                  </div>
                  <div className="mt-4 inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-800">
                    Nível: {getPerformanceLevel(resultado.nota_final)}
                  </div>
                  {resultado.resumo_geral ? (
                    <p className="mt-6 inline-block max-w-3xl rounded-2xl border border-slate-100 bg-white p-6 text-left text-lg italic leading-relaxed text-slate-700 shadow-sm">
                      &quot;{resultado.resumo_geral}&quot;
                    </p>
                  ) : null}
                </div>

                <div className="p-8">
                  <div className="mb-6 flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                      {resultado.aiModel ?? "Modelo não informado"}
                    </span>
                    <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      {getCacheLabel(resultado.cacheSource)}
                    </span>
                  </div>
                  <h3 className="mb-6 border-b-2 border-slate-100 pb-2 text-2xl font-bold text-slate-800">
                    Detalhamento por competência
                  </h3>
                  <div className="space-y-6">
                    {[1, 2, 3, 4, 5].map((num) => {
                      const comp = resultado[
                        `competencia_${num}` as keyof CorrectionResult
                      ] as CorrectionResult[`competencia_1`] | undefined;

                      if (!comp) {
                        return null;
                      }

                      return (
                        <div
                          key={num}
                          className="rounded-2xl border-l-4 border-indigo-500 bg-slate-50 p-6 transition-shadow hover:shadow-md"
                        >
                          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h4 className="text-lg font-bold text-slate-800">
                              Competência {num}
                            </h4>
                            <span className="rounded-full bg-indigo-100 px-4 py-1.5 text-sm font-bold text-indigo-800">
                              {comp.nota} / 200 pts
                            </span>
                          </div>

                          <div className="mb-4">
                            <span className="mb-1 block font-semibold text-slate-700">
                              Diagnóstico:
                            </span>
                            <span className="leading-relaxed text-slate-600">
                              {comp.justificativa}
                            </span>
                          </div>

                          <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
                            <svg
                              className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-500"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <div>
                              <span className="mb-1 block font-semibold text-slate-700">
                                Como melhorar:
                              </span>
                              <span className="text-sm text-slate-600">
                                {comp.melhoria}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {resultado.comparacao ? (() => {
                    const comparacao = resultado.comparacao;

                    return (
                    <div className="mt-8 border-t border-slate-200 pt-8">
                      <h3 className="mb-4 text-2xl font-bold text-slate-800">
                        Comparação com a versão anterior
                      </h3>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Nota anterior
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">
                            {comparacao.previousFinalScore}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Nota atual
                          </div>
                          <div className="mt-2 text-3xl font-black text-slate-900">
                            {comparacao.currentFinalScore}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                          <div className="text-sm font-semibold text-slate-500">
                            Variação
                          </div>
                          <div
                            className={`mt-2 text-3xl font-black ${
                              comparacao.finalScoreDiff > 0
                                ? "text-emerald-700"
                                : comparacao.finalScoreDiff < 0
                                  ? "text-rose-700"
                                  : "text-slate-900"
                            }`}
                          >
                            {formatDiff(comparacao.finalScoreDiff)} pontos
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                        <div className="mb-3 text-sm font-semibold text-slate-700">
                          Evolução por competência
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                          {comparacao.competencyDiffs.map((diff, index) => (
                            <div
                              key={`comparison-${index + 1}`}
                              className="rounded-xl border border-slate-200 bg-white p-4"
                            >
                              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                C{index + 1}
                              </div>
                              <div className="mt-2 text-sm text-slate-600">
                                {comparacao.previousCompetencies[index]} →{" "}
                                {comparacao.currentCompetencies[index]}
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

                      <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-5 text-sm leading-7 text-slate-700">
                        <span className="font-semibold text-slate-900">
                          Resumo da evolução:
                        </span>{" "}
                        {comparacao.summary}
                      </div>
                    </div>
                    );
                  })() : null}

                  {resultado.sugestoes_reescrita && resultado.sugestoes_reescrita.length > 0 ? (
                    <div className="mt-8 border-t border-slate-200 pt-8">
                      <h3 className="mb-4 text-2xl font-bold text-slate-800">
                        Sugestões de reescrita
                      </h3>
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
                    </div>
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
