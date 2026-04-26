"use client";

import { useRef, useState } from "react";

type CompetencyResult = {
  nota: number;
  justificativa: string;
  melhoria: string;
};

type CorrectionResult = {
  competencia_1?: CompetencyResult;
  competencia_2?: CompetencyResult;
  competencia_3?: CompetencyResult;
  competencia_4?: CompetencyResult;
  competencia_5?: CompetencyResult;
  nota_final?: number;
  resumo_geral?: string;
  error?: string;
};

export function GraderClient() {
  const [tema, setTema] = useState("");
  const [redacao, setRedacao] = useState("");
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<CorrectionResult | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "sucesso" | "erro";
    texto: string;
  } | null>(null);
  const boletimRef = useRef<HTMLDivElement>(null);

  async function corrigirRedacao() {
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
          tema: tema.trim() === "" ? "Tema livre" : tema,
        }),
      });

      const dados = (await resposta.json()) as CorrectionResult;

      if (!resposta.ok) {
        throw new Error(dados.error ?? "Erro ao processar a correção.");
      }

      setResultado(dados);
      setAviso({
        tipo: "sucesso",
        texto: "Avaliação concluída com sucesso. Role a página para ver o boletim detalhado.",
      });

      setTimeout(() => {
        boletimRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    } catch (error) {
      console.error(error);
      setAviso({
        tipo: "erro",
        texto:
          "Nosso sistema está recebendo muitas redações agora. Aguarde um pouco e tente avaliar novamente.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6">
          <label
            htmlFor="tema"
            className="mb-2 block text-lg font-semibold text-slate-800"
          >
            Qual é o tema da redação? <span className="text-slate-500">(opcional)</span>
          </label>
          <input
            type="text"
            id="tema"
            className="w-full rounded-2xl border border-slate-300 bg-slate-50 p-4 text-lg text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            placeholder="Ex.: Os desafios para combater a desinformação no Brasil"
            value={tema}
            onChange={(event) => setTema(event.target.value)}
            disabled={loading}
          />
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
          disabled={loading}
        />

        <button
          onClick={corrigirRedacao}
          disabled={loading}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-8 py-4 text-lg font-bold text-white shadow-lg transition ${
            loading
              ? "cursor-not-allowed bg-indigo-400"
              : "bg-indigo-600 hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-indigo-200"
          }`}
        >
          {loading ? "Processando avaliação..." : "Solicitar correção"}
        </button>

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

      <div ref={boletimRef}>
        {resultado?.nota_final !== undefined ? (
          <div className="mt-12 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 p-8 text-center">
              <h2 className="mb-2 text-xl font-bold uppercase tracking-[0.25em] text-slate-500">
                Nota final
              </h2>
              <div className="bg-gradient-to-r from-indigo-600 to-indigo-900 bg-clip-text text-7xl font-black text-transparent">
                {resultado.nota_final}
              </div>
              {resultado.resumo_geral ? (
                <p className="mt-6 inline-block max-w-3xl rounded-2xl border border-slate-100 bg-white p-6 text-left text-lg italic leading-relaxed text-slate-700 shadow-sm">
                  &quot;{resultado.resumo_geral}&quot;
                </p>
              ) : null}
            </div>

            <div className="p-8">
              <h3 className="mb-6 border-b-2 border-slate-100 pb-2 text-2xl font-bold text-slate-800">
                Detalhamento por competência
              </h3>
              <div className="space-y-6">
                {[1, 2, 3, 4, 5].map((num) => {
                  const comp = resultado[
                    `competencia_${num}` as keyof CorrectionResult
                  ] as CompetencyResult | undefined;

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
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
