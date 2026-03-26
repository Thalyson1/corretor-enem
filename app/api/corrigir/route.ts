import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY as string;

    // 🕵️‍♂️ MODO DETETIVE: Pede pro Google a lista exata de modelos permitidos para a sua chave
    const checkModels = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const modelsJson = await checkModels.json();
    const modelosPermitidos = modelsJson.models?.map((m: any) => m.name).filter((name: string) => name.includes("gemini"));
    console.log("👉 MODELOS PERMITIDOS NA SUA CONTA:", modelosPermitidos);

    // 1. Recebe o texto
    const { texto, tema } = await request.json();

    // 2. Chama o Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Vamos testar a versão 2.0-flash (a mais rápida e atualizada)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 1.0 // Zero a 1. Deixa a IA super focada e menos "criativa" nas notas.
      }
    });

    // 3. Prompt Mestre
    // 3. O Mega Prompt Mestre do INEP
   const promptMestre = `Você é um corretor SÊNIOR e experiente da banca do ENEM (INEP).
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial, MAS COM UM OLHAR HUMANO, COMPREENSIVO E HOLÍSTICO.
    
    TEMA PROPOSTO PARA ESTA REDAÇÃO: "${tema}"
    (Se o tema for "Tema livre", avalie apenas a coerência interna e ignore a fuga ao tema).
    
    1. FILTRO DE ANULAÇÃO (SITUAÇÕES QUE ZERAM A REDAÇÃO) 
    Antes de avaliar as competências, verifique se o texto possui:
    - Fuga ao tema (não trata do assunto proposto no TEMA PROPOSTO acima).
    - Fuga ao tema (não trata do assunto proposto).
    - Não atendimento ao tipo textual (é um poema, conto ou narrativa, em vez de dissertação).
    - Parte desconectada (impropérios, ofensas, zombaria, recados soltos, orações religiosas ou deboches no meio do texto).
    - Desrespeito aos Direitos Humanos (Zera apenas a Competência 5).
    Se houver Fuga, Não Atendimento ou Parte Desconectada, a nota de TODAS as competências DEVE SER 0. Escreva o motivo claramente na justificativa.

    2. REGRA DE OURO (LEITURA FLUIDA E HUMANIZADA)
    Lembre-se que o aluno escreveu à mão, sob pressão. Se o texto demonstra maturidade, vocabulário rico, excelente argumentação e flui muito bem, NÃO rebaixe as notas por falhas microscópicas ou deslizes pontuais.
    
    3. APLICAÇÃO DA GRADE OFICIAL:
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

    // 4. Manda para a IA pensar
    const result = await model.generateContent(promptMestre);
    const response = await result.response;
    let jsonText = response.text();
    
    // 5. Limpeza de Segurança
    jsonText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
    
    // 6. Devolve as notas prontas
    return NextResponse.json(JSON.parse(jsonText));

  } catch (error) {
    console.error("Erro na API:", error);
    return NextResponse.json({ error: 'Erro ao corrigir a redação.' }, { status: 500 });
  }
}