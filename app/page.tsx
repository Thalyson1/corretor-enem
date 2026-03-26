'use client';
import { useState } from 'react';

export default function Home() {
  const [tema, setTema] = useState('');
  const [redacao, setRedacao] = useState('');
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<any>(null);

  const corrigirRedacao = async () => {
    if (!redacao.trim()) {
      alert("Por favor, cole uma redação antes de enviar!");
      return;
    }

    setLoading(true);
    setResultado(null);

    try {
      const resposta = await fetch('/api/corrigir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Agora enviamos o tema e a redação para o backend
        body: JSON.stringify({ 
          texto: redacao,
          tema: tema.trim() === '' ? 'Tema livre' : tema 
        }),
      });

      const dados = await resposta.json();
      setResultado(dados);
    } catch (erro) {
      console.error(erro);
      alert("Ops! Ocorreu um erro ao conectar com a IA.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-gradient-to-r from-slate-900 to-indigo-900 text-white py-12 px-4 sm:px-6 lg:px-8 shadow-md">
        <div className="max-w-5xl mx-auto flex flex-col items-center text-center">
          <svg className="w-16 h-16 mb-4 text-indigo-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14v7" />
          </svg>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">
            Corretor IA <span className="text-indigo-400">Padrão ENEM</span>
          </h1>
          <p className="mt-4 text-lg text-indigo-100 max-w-2xl">
            Plataforma avançada de avaliação textual. Informe o tema, cole sua redação e receba um diagnóstico detalhado.
          </p>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 pb-12">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-6 md:p-8">
          
          {/* NOVO CAMPO: Tema da Redação */}
          <div className="mb-6">
            <label htmlFor="tema" className="block text-lg font-semibold text-slate-800 mb-2">
              Qual é o tema da redação? (Opcional)
            </label>
            <input
              type="text"
              id="tema"
              className="w-full p-4 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-slate-700 text-lg shadow-sm"
              placeholder="Ex: A democratização do acesso ao cinema no Brasil..."
              value={tema}
              onChange={(e) => setTema(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex justify-between items-center mb-4">
            <label htmlFor="redacao" className="block text-lg font-semibold text-slate-800">
              Texto da Redação
            </label>
            <span className="text-sm font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
              Máx. 30 linhas recomendadas
            </span>
          </div>
          
          <textarea
            id="redacao"
            rows={14}
            className="w-full p-5 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all text-slate-700 leading-relaxed text-lg resize-y shadow-inner"
            placeholder="Digite ou cole aqui a sua redação dissertativo-argumentativa..."
            value={redacao}
            onChange={(e) => setRedacao(e.target.value)}
            disabled={loading}
          ></textarea>

          <button
            onClick={corrigirRedacao}
            disabled={loading}
            className={`mt-6 w-full flex justify-center items-center gap-2 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all text-lg ${
              loading 
                ? 'bg-indigo-400 cursor-not-allowed' 
                : 'bg-indigo-600 hover:bg-indigo-700 hover:-translate-y-1 hover:shadow-indigo-200'
            }`}
          >
            {loading ? 'Processando Avaliação...' : 'Solicitar Correção Oficial'}
          </button>
        </div>

        {/* ... (O resto do código do boletim continua igual, deixei omitido aqui para não ficar gigante, mas você não precisa mexer na parte de baixo do seu arquivo original se não quiser, ou pode colar por cima se copiou tudo) */}
        {resultado && resultado.nota_final !== undefined && (
          <div className="mt-12 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-fade-in-up">
            <div className="bg-slate-50 border-b border-slate-200 p-8 text-center">
              <h2 className="text-xl font-bold text-slate-500 uppercase tracking-widest mb-2">Nota Final</h2>
              <div className="text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-indigo-900">
                {resultado.nota_final}
              </div>
              <p className="mt-6 text-slate-700 text-lg leading-relaxed bg-white p-6 rounded-xl shadow-sm border border-slate-100 inline-block max-w-3xl text-left italic">
                "{resultado.resumo_geral}"
              </p>
            </div>
            <div className="p-8">
              <h3 className="text-2xl font-bold text-slate-800 mb-6 border-b-2 border-slate-100 pb-2">
                Detalhamento por Competência
              </h3>
              <div className="space-y-6">
                {[1, 2, 3, 4, 5].map((num) => {
                  const comp = resultado[`competencia_${num}`];
                  if (!comp) return null;
                  return (
                    <div key={num} className="bg-slate-50 rounded-xl p-6 border-l-4 border-indigo-500 hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-2">
                        <h4 className="text-lg font-bold text-slate-800">Competência {num}</h4>
                        <span className="bg-indigo-100 text-indigo-800 py-1.5 px-4 rounded-full font-bold text-sm">
                          {comp.nota} / 200 pts
                        </span>
                      </div>
                      <div className="mb-4">
                        <span className="font-semibold text-slate-700 block mb-1">Diagnóstico:</span>
                        <span className="text-slate-600 leading-relaxed">{comp.justificativa}</span>
                      </div>
                      <div className="bg-white p-4 rounded-lg border border-slate-200 flex items-start gap-3">
                        <svg className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <span className="font-semibold text-slate-700 block mb-1">Como melhorar:</span>
                          <span className="text-slate-600 text-sm">{comp.melhoria}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}