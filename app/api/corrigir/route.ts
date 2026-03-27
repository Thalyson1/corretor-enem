import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { texto, tema } = await request.json();

    // 1. REGRA DAS 7 LINHAS (Filtro Anti-Zueira)
    const numeroDePalavras = texto.trim().split(/\s+/).length;
    if (numeroDePalavras < 70) {
      return NextResponse.json({
        competencia_1: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "Escreva pelo menos 70 palavras para que sua redação possa ser avaliada." },
        competencia_2: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_3: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_4: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_5: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        nota_final: 0,
        resumo_geral: "🛑 REDAÇÃO ANULADA: O texto apresenta menos de 7 linhas (mínimo de 70 palavras estimadas), o que configura insuficiência de texto segundo os critérios do INEP."
      });
    }

    // 2. CHAVEIRO MÁGICO (Alterna entre suas chaves de API do Vercel)
    const chavesDisponiveis = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3
    ].filter(Boolean);

    if (chavesDisponiveis.length === 0) {
      throw new Error("Nenhuma chave de API configurada no Vercel.");
    }

    // 3. PROMPT SNIPER 3.0 (Calibrado para Redações 900+ e Rigoroso com 500)
    const promptMestre = `Você é um corretor SÊNIOR da banca do ENEM (INEP). Sua missão é ser JUSTO E IMPARCIAL.
    
    TEMA DA REDAÇÃO: "${tema}"

    🚀 1. REGRA DE OURO (VALORIZAÇÃO DA ELITE):
    Se o aluno demonstra vocabulário sofisticado (ex: "heurística", "inadmissível", "perdurar"), usa citações culturais (músicas, filmes, livros) e conecta argumentos com fluidez, ELE É UM ALUNO DE ELITE. 
    Nesses casos, RELEVE até 2 desvios gramaticais leves na C1 e VALIDE o repertório (C2) como PRODUTIVO se houver conexão lógica. Se o texto é de alto nível, a nota final DEVE refletir isso (880 a 960).

    🕵️‍♂️ 2. DETECTOR DE REPERTÓRIO CURINGA (C2 e C3):
    - REGRA DO BRASIL REAL: Se o texto focar APENAS em filosofia/história antiga e NÃO trouxer dados, leis brasileiras atuais ou exemplos práticos da realidade do Brasil hoje, a nota da C2 e C3 deve ter um TETO de 120 ou 160. Não se deixe enganar por palavras difíceis se o argumento for puramente teórico e sem "chão de fábrica".
    - Se a citação (Locke, Bauman, etc.) for "jogada" sem explicação, é CURINGA: nota 120.
    - Se a citação (como Gabriel o Pensador ou Hans Jonas) for explicada e amarrada ao tema, é PRODUTIVO: nota 200.

    🧮 3. MATEMÁTICA DA CONCLUSÃO (C5):
    - Conte 5 elementos: Agente, Ação, Meio/Modo, Efeito e Detalhamento. 
    - Cada elemento vale 40 pontos. 
    - Considere explicações sobre o papel do órgão (ex: "órgão responsável por elaborar leis") como DETALHAMENTO válido.

    📊 4. GRADE OFICIAL (NOTAS PERMITIDAS: 0, 40, 80, 120, 160, 200):
    - C1 (Gramática): 200 (Excelente). 160 (Boa). 120 (Muitos erros).
    - C2 (Repertório): 200 (Produtivo). 160 (Pertinente). 120 (Curinga/Superficial).
    - C3 (Coerência): 200 (Projeto autoral). 160 (Boa argumentação). 120 (Senso comum).
    - C4 (Coesão): 200 (Sem repetições, uso de conectivos). 160 (Raras repetições). 120 (Regular).
    - C5 (Intervenção): 40 pts por elemento identificado.

    IMPORTANTE: A nota_final deve ser a soma exata das 5 competências.
    Retorne ESTRITAMENTE um objeto JSON puro, sem textos extras:
    {
      "competencia_1": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_2": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_3": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_4": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_5": { "nota": 0, "justificativa": "", "melhoria": "" },
      "nota_final": 0,
      "resumo_geral": ""
    }
    
    REDAÇÃO PARA AVALIAR: "${texto}"`;

    // 4. ROLETA DE MODELOS (Apenas os Gênios)
    const modelosParaTestar = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
    
    let rawResponse = "";
    let sucesso = false;

    // Loop pelas Chaves e depois pelos Modelos
    for (const key of chavesDisponiveis) {
      if (sucesso) break;
      const genAI = new GoogleGenerativeAI(key as string);

      for (const modelName of modelosParaTestar) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent(promptMestre);
          rawResponse = result.response.text();
          sucesso = true;
          break;
        } catch (err) {
          console.error(`Falha no modelo ${modelName} com uma das chaves.`);
        }
      }
    }

    if (!sucesso) throw new Error("Limite de API excedido em todas as chaves.");

    // 5. LIMPEZA DE SEGURANÇA DO JSON (Onde o erro de 'C' é resolvido)
    const startIdx = rawResponse.indexOf('{');
    const endIdx = rawResponse.lastIndexOf('}') + 1;
    const jsonString = rawResponse.substring(startIdx, endIdx);

    const avaliacao = JSON.parse(jsonString);
    return NextResponse.json(avaliacao);

  } catch (error) {
    console.error("Erro na API de Correção:", error);
    return NextResponse.json(
      { error: "Ocorreu um erro ao processar sua nota. Tente novamente em 2 minutos." },
      { status: 500 }
    );
  }
}