import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { texto, tema } = await request.json();

    // 🛑 FILTRO DE TAMANHO (Regra das 7 linhas do ENEM)
    const numeroDePalavras = texto.trim().split(/\s+/).length;
    if (numeroDePalavras < 70) {
      return NextResponse.json({
        competencia_1: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_2: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_3: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_4: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_5: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        nota_final: 0,
        resumo_geral: "🛑 TEXTO INSUFICIENTE: De acordo com as regras oficiais do ENEM, redações com até 7 linhas recebem nota zero."
      });
    }

    // 🔑 O CHAVEIRO MÁGICO (Pega todas as chaves cadastradas no Vercel)
    const chavesDisponiveis = [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3 // Se quiser adicionar mais depois, o código já está pronto!
    ].filter(Boolean); // O filter(Boolean) remove as chaves que estiverem vazias

    if (chavesDisponiveis.length === 0) {
      throw new Error("Nenhuma chave de API configurada.");
    }

    // 🧠 Prompt Mestre Calibrado
    const promptMestre = `Você é um corretor SÊNIOR da banca do ENEM (INEP). Sua missão é ser JUSTO.
    
    TEMA: "${tema}"

    🚀 1. REGRA DE OURO (NÃO SEJA UM ROBÔ):
    Se o aluno demonstra um vocabulário sofisticado, usa citações culturais (músicas, filmes, livros) e consegue conectar os argumentos com fluidez, ELE É UM ALUNO DE ELITE. 
    Nesses casos, RELEVE 1 ou 2 erros gramaticais leves e VALIDE o repertório mesmo que pareça comum. Se o texto é bom, a nota DEVE estar entre 880 e 960.

    🕵️‍♂️ 2. CRITÉRIOS TÉCNICOS:
    - C1 (Gramática): 200 (Excelente, admite-se 2 desvios). 160 (Poucos erros). 120 (Muitos).
    - C2/C3 (Repertório e Argumento): Se o aluno cita uma música (ex: Gabriel o Pensador) ou filósofo e explica a relação com o tema, o uso é PRODUTIVO. Dê 200. Só dê 120 se ele citar e NÃO explicar nada.
    - C4 (Coesão): Use o teto de 160 se houver repetições excessivas. Se fluir bem, dê 200.
    - C5 (Conclusão): Conte 5 elementos (Agente, Ação, Meio, Efeito, Detalhamento). Considere explicações sobre o papel do órgão (ex: "órgão responsável por...") como DETALHAMENTO válido. Cada elemento vale 40 pontos.

    🚨 3. MATEMÁTICA:
    Use APENAS 0, 40, 80, 120, 160, 200 por competência. A soma deve ser exata.

    Retorne em JSON:
    {
      "competencia_1": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_2": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_3": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_4": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_5": { "nota": 0, "justificativa": "", "melhoria": "" },
      "nota_final": 0,
      "resumo_geral": ""
    }
    
    Redação: "${texto}"`;

    const modelosParaTestar = [
      "gemini-2.5-pro",
      "gemini-2.5-flash", 
      "gemini-2.0-flash",
    ];
    
    let jsonText = "";
    let avaliacaoConcluida = false;

    // 🔄 O SUPER LOOP (Tenta Chave 1. Se falhar, tenta Chave 2...)
    for (let i = 0; i < chavesDisponiveis.length; i++) {
      if (avaliacaoConcluida) break; // Se já conseguiu a nota, para tudo.
      
      const genAI = new GoogleGenerativeAI(chavesDisponiveis[i] as string);
      console.log(`🔑 Testando com a Chave de API número ${i + 1}...`);

      for (const nomeDoModelo of modelosParaTestar) {
        try {
          console.log(`⏳ Tentando o modelo: ${nomeDoModelo}...`);
          const model = genAI.getGenerativeModel({ 
            model: nomeDoModelo,
            generationConfig: { temperature: 0.7 }
          });

          const result = await model.generateContent(promptMestre);
          const response = await result.response;
          jsonText = response.text();
          
          avaliacaoConcluida = true;
          console.log(`✅ SUCESSO! Avaliado com Chave ${i + 1} e Modelo ${nomeDoModelo}`);
          break; // Sai do loop de modelos
        } catch (erroDeModelo) {
          console.error(`❌ Falha no modelo ${nomeDoModelo} com a Chave ${i + 1}.`);
        }
      }
    }

    if (!avaliacaoConcluida) {
      throw new Error("Todas as chaves e modelos atingiram o limite ou falharam.");
    }

    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    return NextResponse.json(JSON.parse(jsonText));

  } catch (error) {
    console.error("Erro geral na API:", error);
    return NextResponse.json({ error: 'Erro ao corrigir a redação.' }, { status: 500 });
  }
}