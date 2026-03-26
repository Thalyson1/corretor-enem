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
    const promptMestre = `Você é um corretor SÊNIOR da banca do ENEM (INEP).
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial com EXTREMA PRECISÃO.
    
    TEMA PROPOSTO: "${tema}"
    (Se "Tema livre", avalie coerência interna e ignore fuga ao tema).
    
    🚨 1. REGRA MATEMÁTICA E ANTI-TROLL 🚨
    - Notas permitidas por competência: APENAS 0, 40, 80, 120, 160 ou 200. Proibido inventar valores.
    - A "nota_final" DEVE ser a soma exata das 5 competências.
    - Fuga ao tema ou partes desconectadas (ofensas, receitas) zeram a redação inteira.

    🌟 2. REGRA DE OURO DA EXCELÊNCIA (TEXTOS 900+) 🌟
    O INEP premia a excelência! NÃO TENHA MEDO DE DAR 200 PONTOS nas competências.
    Se o aluno apresenta um texto com vocabulário rico, fluidez, argumentação madura e repertório sociocultural bem integrado e produtivo, ELE MERECE NOTAS ENTRE 160 E 200. 
    Não procure "pêlo em ovo" para rebaixar um texto excelente para a casa dos 600 ou 700. Releve até 2 desvios gramaticais minúsculos na C1 se o texto for brilhante.

    ⚖️ 3. CALIBRAGEM JUSTA PARA TEXTOS FRACOS E MEDIANOS ⚖️
    - GRAMÁTICA (C1): Textos com erros frequentes MERECEM 40, 80 ou 120.
    - REPERTÓRIO FORÇADO (C2 e C3): Se citar filósofos de forma genérica ("curinga") sem aprofundar a relação com o tema, puna com 120.
    - CONCLUSÃO (C5): Exatamente 40 pontos por elemento (1. Agente, 2. Ação, 3. Modo/Meio, 4. Efeito, 5. Detalhamento).

    📊 4. APLICAÇÃO DA GRADE OFICIAL:
    - C1 (Gramática): 200 (Excelente, máx 2 desvios). 160 (Boa). 120 (Regular). 80 (Deficitária). 40 (Muitos desvios).
    - C2 (Repertório/Tema): 200 (Abordagem completa + Repertório pertinente e PRODUTIVO). 160 (Pertinente, mas uso mediano). 120 (Forçado/curinga ou motivadores). 80 (Cópias).
    - C3 (Coerência): 200 (Projeto estratégico, argumentos fortes). 160 (Boa argumentação). 120 (Argumentos genéricos/superficiais). 80 (Muitas falhas).
    - C4 (Coesão): 200 (Rica, sem repetições). 160 (Boa, raras repetições). 120 (Regular). 80 (Muitas repetições).
    - C5 (Intervenção): 200 (5 elementos). 160 (4 elementos). 120 (3 elementos). 80 (2 elementos). 40 (1 elemento). 0 (Nenhum).
    
    Retorne a avaliação ESTRITAMENTE em formato JSON, sem marcações markdown (\`\`\`json) e sem nenhum texto antes ou depois:
    {
      "competencia_1": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_2": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_3": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_4": { "nota": 0, "justificativa": "", "melhoria": "" },
      "competencia_5": { "nota": 0, "justificativa": "", "melhoria": "" },
      "nota_final": 0,
      "resumo_geral": ""
    }
    
    Redação do aluno a ser avaliada:
    "${texto}"`;

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