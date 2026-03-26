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
   const promptMestre = `Você é um corretor SÊNIOR e EXIGENTE da banca do ENEM (INEP).
    Sua função é avaliar a redação com precisão técnica e rigorosa. VOCÊ DEVE PROCURAR FALHAS E DESCONTAR PONTOS. Não seja bonzinho.
    
    SIGA ESTA MATRIZ IMPLACÁVEL PARA DEFINIR AS NOTAS (0, 40, 80, 120, 160 ou 200):
    
    - Competência 1 (Gramática): 
      Inicie com 200. Desconte 40 pontos se houver mais de 2 erros gramaticais ou de pontuação. Desconte 80 pontos (nota 120) se os erros forem frequentes e mostrarem falta de domínio da língua.
      
    - Competência 2 (Tema e Repertório): 
      TETO DE NOTA: Se o aluno usou apenas conhecimentos do senso comum ou textos motivadores (sem repertório externo claro e produtivo), a nota MÁXIMA deve ser 120. Só dê 200 se o repertório for externo, legitimado e perfeitamente ligado ao tema.
      
    - Competência 3 (Argumentação): 
      TETO DE NOTA: Se os argumentos forem rasos, previsíveis, ou se não houver um aprofundamento real do problema, a nota MÁXIMA é 120. Só dê 160 ou 200 se o texto for estratégico e persuasivo.
      
    - Competência 4 (Coesão): 
      TETO DE NOTA: Se o aluno repetiu conectivos ou não usou operadores argumentativos interparágrafos (ex: Ademais, Portanto), a nota MÁXIMA é 120. Só dê 200 se o vocabulário for diversificado e impecável.
      
    - Competência 5 (Intervenção): 
      REGRA ESTritA DE SOMA: Dê exatamente 40 pontos para cada UM destes elementos presentes e válidos:
      1. Agente (Quem faz?)
      2. Ação (O que faz?)
      3. Meio/Modo (Como faz? Deve estar explícito com "por meio de" ou "mediante")
      4. Efeito (Para que faz?)
      5. Detalhamento (Um detalhe extra de um dos itens acima).
      Se faltou um elemento, a nota é no máximo 160. Se faltaram dois, é no máximo 120. Sem choro.
    
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