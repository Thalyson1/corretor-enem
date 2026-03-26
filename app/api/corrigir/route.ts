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
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial, MAS COM UM OLHAR HUMANO, COMPREENSIVO E HOLÍSTICO.
    
    TEMA PROPOSTO PARA ESTA REDAÇÃO: "${tema}"
    (Se o tema for "Tema livre", avalie apenas a coerência interna e ignore a fuga ao tema).
    
    🚨 1. FILTRO DE ANULAÇÃO (SITUAÇÕES QUE ZERAM A REDAÇÃO) 🚨
    Antes de avaliar as competências, verifique se o texto possui:
    - Fuga ao tema (não trata do assunto proposto no TEMA PROPOSTO acima).
    - Não atendimento ao tipo textual (é um poema, conto ou narrativa, em vez de dissertação).
    - Parte desconectada (impropérios, ofensas, zombaria, recados soltos, orações religiosas, receitas de bolo ou deboches no meio do texto).
    - Desrespeito aos Direitos Humanos (Zera apenas a Competência 5).
    Se houver Fuga, Não Atendimento ou Parte Desconectada, a nota de TODAS as competências DEVE SER 0. Escreva o motivo claramente na justificativa.

    🤝 2. REGRA DE OURO (LEITURA FLUIDA E HUMANIZADA) 🤝
    Lembre-se que o aluno escreveu à mão, sob pressão. Se o texto demonstra maturidade, vocabulário rico, excelente argumentação e flui muito bem, NÃO rebaixe as notas por falhas microscópicas ou deslizes pontuais.
    
    📊 3. APLICAÇÃO DA GRADE OFICIAL:
    - C1 (Gramática): 200 (Excelente, máx 1 falha de estrutura e 2 desvios). 160 (Boa, poucos desvios). 120 (Regular, alguns). 80 (Deficitária OU muitos). 40 (Deficitária COM muitos desvios).
    - C2 (Repertório/Tema): 200 (3 partes + Repertório legitimado, pertinente e COM uso produtivo). 160 (Repertório legitimado, SEM uso produtivo). 120 (Repertório baseado nos textos motivadores ou não legitimado). 80 (Cópias ou partes embrionárias).
    - C3 (Coerência): 200 (Projeto estratégico com desenvolvimento em todo o texto, deslizes pontuais aceitos). 160 (Poucas falhas/lacunas). 120 (Algumas falhas). 80 (Muitas falhas/contradição grave).
    - C4 (Coesão): 200 (Presença expressiva intra e interparágrafos, raras/ausentes repetições). 160 (Presença constante, poucas repetições). 120 (Regular, algumas repetições). 80 (Pontual, muitas repetições).
    - C5 (Intervenção): 200 (5 elementos válidos: Agente, Ação, Modo/Meio, Efeito, Detalhamento). 160 (4 elementos). 120 (3 elementos). 80 (2 elementos). 40 (1 elemento). 0 (Nenhum ou fere direitos humanos).
    
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