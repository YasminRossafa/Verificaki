import { createServerFn } from '@tanstack/react-start'
import { GoogleGenAI } from '@google/genai'

export type VerificarInput = {
  inputType: 'link' | 'text' | 'image'
  inputValue: string
}

export type VerificarSource = {
  title: string
  url: string
}

export type VerificarResult = {
  score: number
  summary: string
  sources: VerificarSource[]
}

export const verificarNoticia = createServerFn({ method: 'POST' })
  .validator((data: VerificarInput) => data)
  .handler(async ({ data }): Promise<VerificarResult> => {
    const { inputType, inputValue } = data

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server')

    const ai = new GoogleGenAI({ apiKey })

    let contents: unknown

    const jsonSchema = `{
  "score": <número inteiro de 0 a 100>,
  "summary": "<análise detalhada em 3 a 5 frases em português, explicando os principais elementos verificados, o que é verdadeiro, o que é falso ou enganoso, e por quê chegou à pontuação dada>",
  "sources": [
    { "title": "<nome da fonte>", "url": "<URL real e acessível>" }
  ]
}`

    const sourceGuidance = `Inclua entre 4 e 7 fontes reais e verificáveis, priorizando agências de fact-checking brasileiras e internacionais (Agência Lupa em https://lupa.uol.com.br, Aos Fatos em https://aosfatos.org, Comprova em https://projetocomprova.com.br, AFP Checamos em https://checamos.afp.com, Reuters Fact Check em https://reuters.com/fact-check) e veículos jornalísticos confiáveis relevantes ao tema. Quando possível, forneça a URL de um artigo específico sobre o assunto; caso contrário, use a URL da página inicial da organização.`

    if (inputType === 'image') {
      const separatorIndex = inputValue.indexOf(',')
      const meta = inputValue.slice(0, separatorIndex)
      const base64Data = inputValue.slice(separatorIndex + 1)
      const mimeType = meta.match(/:(.*?);/)?.[1] ?? 'image/jpeg'

      contents = [
        {
          role: 'user',
          parts: [
            { inlineData: { data: base64Data, mimeType } },
            {
              text: `Analise essa imagem quanto à presença de fake news ou desinformação. Retorne APENAS um objeto JSON com esta estrutura exata, sem markdown, sem blocos de código:\n${jsonSchema}\n\nScore 0 significa completamente falso/enganoso, 100 significa completamente verdadeiro/confiável. ${sourceGuidance}`,
            },
          ],
        },
      ]
    } else {
      const typeLabel = inputType === 'link' ? 'link/URL' : 'texto'
      const contentLabel = inputType === 'link' ? `URL: ${inputValue}` : `Texto: ${inputValue}`

      contents = `Analise o seguinte ${typeLabel} quanto à presença de fake news ou desinformação. Retorne APENAS um objeto JSON com esta estrutura exata, sem markdown, sem blocos de código:\n${jsonSchema}\n\nScore 0 significa completamente falso/enganoso, 100 significa completamente verdadeiro/confiável. ${sourceGuidance}\n\n${contentLabel}`
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contents: contents as any,
    })

    const raw = response.text
    if (!raw) throw new Error('Empty response from Gemini')

    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start === -1 || end === -1 || start >= end) {
      throw new Error(`No JSON found in Gemini response: ${raw.slice(0, 200)}`)
    }

    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      score: unknown
      summary: unknown
      sources: unknown
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))))
    const summary = typeof parsed.summary === 'string' ? parsed.summary : ''
    const sourcesRaw = Array.isArray(parsed.sources) ? parsed.sources : []
    const sources = sourcesRaw
      .filter(
        (s): s is { title: string; url: string } =>
          typeof s === 'object' &&
          s !== null &&
          typeof (s as Record<string, unknown>).title === 'string' &&
          typeof (s as Record<string, unknown>).url === 'string',
      )
      .slice(0, 8)

    return { score, summary, sources }
  })
 