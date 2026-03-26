import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    // 1. Recebe os dados da requisição (texto da redação e o tema)
    const { texto, tema } = await request.json();

    // 🛑 FILTRO DE TAMANHO (Regra das 7 linhas do ENEM)
    // Uma linha manuscrita tem em média 10 palavras. 7 linhas = ~70 palavras.
    const numeroDePalavras = texto.trim().split(/\s+/).length;
    if (numeroDePalavras < 70) {
      return NextResponse.json({
        competencia_1: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_2: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_3: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_4: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        competencia_5: { nota: 0, justificativa: "Texto insuficiente.", melhoria: "" },
        nota_final: 0,
        resumo_geral: "🛑 TEXTO INSUFICIENTE: De acordo com as regras oficiais do ENEM, redações com até 7 linhas (ou muito curtas) recebem nota zero."
      });
    }

    // 2. Chave de API
    const apiKey = process.env.GEMINI_API_KEY as string;
    if (!apiKey) {
      throw new Error("Chave da API do Gemini não configurada.");
    }
    const genAI = new GoogleGenerativeAI(apiKey);

    // 3. Prompt Mestre (Humanizado + Anti-Troll + Tema Específico)
    const promptMestre = `Você é um corretor SÊNIOR e experiente da banca do ENEM (INEP).
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial. TENHA UM OLHAR HUMANO PARA A GRAMÁTICA, MAS SEJA IMPLACÁVEL COM A ARGUMENTAÇÃO E A ESTRUTURA.
    
    TEMA PROPOSTO PARA ESTA REDAÇÃO: "${tema}"
    (Se o tema for "Tema livre", avalie apenas a coerência interna e ignore a fuga ao tema).
    
    🚨 1. FILTRO DE ANULAÇÃO (NOTA ZERO) 🚨
    - Fuga ao tema, não atendimento ao tipo textual (poema, conto), parte desconectada (impropérios, ofensas, deboches, receitas de bolo) zeram a redação inteira.
    - Desrespeito aos Direitos Humanos zera a Competência 5.

    👁️ 2. DIRETRIZES DO CORRETOR SÊNIOR (CUIDADO COM AS ARMADILHAS) 👁️
    - GRAMÁTICA (C1 e C4): Seja compreensivo. Releve 2 ou 3 pequenos deslizes se o texto demonstrar excelente fluidez, vocabulário maduro e for bem escrito.
    - REPERTÓRIO CURINGA (C2 e C3): SEJA RIGOROSO. O INEP pune severamente citações forçadas de filósofos (ex: Bauman, Locke, Simone de Beauvoir) ou "modelos prontos" que não têm ligação orgânica e aprofundada com o tema central. Se o repertório for "curinga" ou genérico, ele NÃO tem "Uso Produtivo". A nota da C2 deve cair para 160 ou 120, e a C3 deve ser punida por falta de aprofundamento do problema.
    - MATEMÁTICA DA CONCLUSÃO (C5): SEJA UM COMPUTADOR IMPLACÁVEL. Não dê nota por pena. Exija e conte os 5 elementos: 1. Agente, 2. Ação, 3. Modo/Meio, 4. Efeito, 5. Detalhamento.
      * ATENÇÃO: "Por meio do Estado/Governo" NÃO É Modo/Meio se o Estado já for o Agente. Exija um meio prático (ex: "por meio de campanhas nas escolas" ou "via verbas públicas"). Faltou um elemento claro? A nota cai 40 pontos, sem choro.

    📊 3. APLICAÇÃO DA GRADE OFICIAL:
    - C1 (Gramática): 200 (Excelente, máx 1 falha estrutura, 2 desvios). 160 (Boa). 120 (Regular). 80 (Deficitária). 40 (Muitos desvios).
    - C2 (Repertório/Tema): 200 (3 partes + Repertório legitimado, pertinente e COM EXCELENTE uso produtivo real). 160 (Repertório pertinente, MAS com uso forçado/curinga). 120 (Repertório do texto motivador ou não legitimado). 80 (Cópias).
    - C3 (Coerência): 200 (Projeto estratégico, argumentação forte). 160 (Poucas falhas, bom argumento). 120 (Argumentos genéricos/curingas, sem aprofundar). 80 (Muitas falhas/contradição).
    - C4 (Coesão): 200 (Expressiva, raras repetições). 160 (Constante, poucas repetições). 120 (Regular). 80 (Muitas repetições).
    - C5 (Intervenção): 200 (5 elementos válidos). 160 (4 elementos). 120 (3 elementos). 80 (2 elementos). 40 (1 elemento). 0 (Nenhum).
    
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

    // 4. Roleta de Modelos (Fallback - Tolerância a falhas)
    const modelosParaTestar = [
      "gemini-2.5-flash", 
      "gemini-2.5-flash-lite", 
      "gemini-2.0-flash",
      "gemini-1.5-flash" // Adicionei um ultra-estável no final da fila por segurança
    ];
    
    let jsonText = "";
    let avaliacaoConcluida = false;

    for (const nomeDoModelo of modelosParaTestar) {
      try {
        console.log(`⏳ Tentando avaliar com o modelo: ${nomeDoModelo}...`);
        
        const model = genAI.getGenerativeModel({ 
          model: nomeDoModelo,
          generationConfig: {
            temperature: 0.7 
          }
        });

        const result = await model.generateContent(promptMestre);
        const response = await result.response;
        jsonText = response.text();
        
        avaliacaoConcluida = true;
        console.log(`✅ Sucesso! Redação avaliada usando: ${nomeDoModelo}`);
        break; // Deu certo, para o loop e segue o jogo!

      } catch (erroDeModelo) {
        console.error(`❌ O modelo ${nomeDoModelo} falhou. Indo para o próximo...`);
      }
    }

    // Se o loop rodou inteiro e não achou nenhum modelo disponível
    if (!avaliacaoConcluida) {
      throw new Error("Todos os modelos de IA atingiram o limite ou falharam.");
    }

    // 5. Limpeza de Segurança do JSON
    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 6. Devolve as notas prontas para o site
    return NextResponse.json(JSON.parse(jsonText));

  } catch (error) {
    console.error("Erro geral na API:", error);
    return NextResponse.json({ error: 'Erro ao corrigir a redação.' }, { status: 500 });
  }
}