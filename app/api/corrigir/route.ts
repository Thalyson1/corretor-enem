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
    const { texto } = await request.json();

    // 2. Chama o Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Vamos testar a versão 2.0-flash (a mais rápida e atualizada)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.9 // Zero a 1. Deixa a IA super focada e menos "criativa" nas notas.
      }
    });

    // 3. Prompt Mestre
    // 3. O Mega Prompt Mestre do INEP
   const promptMestre = `Você é um corretor SÊNIOR e experiente da banca do ENEM (INEP).
    Sua missão é avaliar a redação aplicando a Matriz de Referência Oficial, MAS COM UM OLHAR HUMANO, COMPREENSIVO E HOLÍSTICO.
    
    REGRA DE OURO (LEITURA FLUIDA):
    Lembre-se que o aluno escreveu o texto à mão, sob pressão e com tempo limitado. Não seja um robô punitivo. Se o texto demonstra maturidade, vocabulário rico, excelente argumentação e flui muito bem, NÃO rebaixe as notas por falhas microscópicas. Redações excelentes merecem notas 900+.

    DIRETRIZES DE HUMANIZAÇÃO:
    - Competência 1: Se a estrutura sintática é complexa e madura, dê 200 pontos mesmo que haja 2 ou 3 pequenos desvios de vírgula ou acento que passariam despercebidos por um leitor humano rápido.
    - Competência 4: Se o texto é bem amarrado e tem operadores argumentativos, dê 200 ou 160. Não procure "pêlo em ovo" punindo pequenas repetições se a leitura não for prejudicada.
    - Competência 5: Seja justo. Às vezes o "Meio/Modo" ou o "Detalhamento" estão implícitos no contexto de forma clara. Se a intervenção faz muito sentido e é aplicável, considere dar os 200 pontos.

    AGORA, APLIQUE A GRADE OFICIAL COM BOM SENSO:
    
    - Competência 1 (Conhecimentos linguísticos):
      200: Excelente domínio. Desvios aceitos como excepcionalidade.
      160: Bom domínio. Poucos desvios.
      120: Domínio mediano. Alguns desvios.
      
    - Competência 2 (Tema e Repertório):
      200: Abordagem completa + 3 partes + Repertório legitimado, pertinente e produtivo.
      160: Abordagem completa + 3 partes + Repertório legitimado, mas menos produtivo.
      120: Abordagem completa + Repertório do senso comum ou dos textos motivadores.
      
    - Competência 3 (Coerência e Argumentação):
      200: Projeto de texto estratégico e autoral. Argumentos fortes.
      160: Projeto de texto com poucas falhas. Boa argumentação.
      120: Projeto de texto mediano, argumentos previsíveis.
      
    - Competência 4 (Coesão):
      200: Presença constante de elementos coesivos inter e intraparágrafos, vocabulário rico.
      160: Presença constante, adequados, mas com variedade mediana.
      120: Presença regular, com algumas repetições.
      
    - Competência 5 (Intervenção):
      Avalie: 1. Agente, 2. Ação, 3. Meio/Modo, 4. Efeito, 5. Detalhamento.
      200: Tem os 5 elementos (mesmo que um esteja sutil).
      160: Tem 4 elementos claros.
      120: Tem 3 elementos claros.
    
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