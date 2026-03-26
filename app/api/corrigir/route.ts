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
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial com EXTREMA PRECISÃO. Não seja leniente com textos fracos, mas não seja carrasco com textos excelentes. A nota deve refletir a realidade.
    
    TEMA PROPOSTO: "${tema}"
    (Se "Tema livre", avalie coerência interna e ignore fuga ao tema).
    
    🚨 1. FILTRO DE ANULAÇÃO (NOTA ZERO)
    - Fuga ao tema, não atendimento ao tipo textual (poema, narrativa), partes desconectadas (ofensas, receitas de bolo) zeram a redação inteira.
    - Desrespeito aos Direitos Humanos zera apenas a Competência 5.

    ⚖️ 2. CALIBRAGEM DA CORREÇÃO (O PONTO DE EQUILÍBRIO)
    - GRAMÁTICA (C1 e C4): Seja justo. Textos com erros frequentes de vírgula, concordância e acentuação MERECEM notas baixas (40 ou 80). NÃO perdoe erros estruturais. Só dê 160 ou 200 se a escrita for madura, rica e tiver, no máximo, 2 ou 3 desvios isolados.
    - REPERTÓRIO "CURINGA" vs. REPERTÓRIO PRODUTIVO (C2 e C3): Saiba diferenciar! 
      * Se o aluno cita um pensador (Locke, Bauman, etc.) de forma "solta", sem explicar a relação direta com o problema, é "Curinga": dê 120 na C2 e puna a C3 por argumentação superficial.
      * PORÉM, se a citação faz sentido lógico, é bem explicada e aprofunda o argumento focado no tema, PREMIE com 160 ou 200.
    - MATEMÁTICA DA CONCLUSÃO (C5): 40 pontos por elemento explícito (1. Agente, 2. Ação, 3. Modo/Meio, 4. Efeito, 5. Detalhamento). Se faltar clareza no Modo/Meio, não pontue esse elemento.

    📊 3. APLICAÇÃO DA GRADE OFICIAL:
    - C1 (Gramática): 200 (Excelente, máx 2 desvios). 160 (Boa). 120 (Regular). 80 (Deficitária). 40 (Muitos desvios graves).
    - C2 (Repertório/Tema): 200 (Abordagem completa + Repertório pertinente COM USO PRODUTIVO REAL). 160 (Pertinente, mas uso mediano). 120 (Uso forçado/curinga ou textos motivadores). 80 (Cópias).
    - C3 (Coerência): 200 (Projeto estratégico, argumentos aprofundados). 160 (Boa argumentação, poucas falhas). 120 (Argumentos genéricos/superficiais). 80 (Muitas falhas).
    - C4 (Coesão): 200 (Vocabulário rico, operadores inter e intraparágrafos sem repetições). 160 (Boa presença, raras repetições). 120 (Regular). 80 (Muitas repetições).
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
      "gemini-2.5-flash", 
      "gemini-2.0-flash", 
      "gemini-2.5-pro", 
      "gemini-2.5-flash-lite", 
      "gemini-1.5-pro"
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