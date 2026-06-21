import { createServerFn } from "@tanstack/react-start";
import { GoogleGenAI } from "@google/genai";
import {
  MAX_CONCURRENCY,
  mapWithConcurrency,
  resolveLiveUrl,
} from "../../lib/url-safety";

// ───────────────────────────────────────────────
// Input / output contract (field names are shared with the frontend)
// ───────────────────────────────────────────────
export type VerificarInput = {
  inputType: "link" | "text" | "image";
  /** Used for the link and text modes. */
  inputValue?: string;
  /** Used for the image mode: 1 to 3 base64 data URLs. */
  images?: string[];
};

export type Etapa = 1 | 2 | 3;

export type VerificarStatus =
  | "Verdadeiro"
  | "Falso"
  | "Enganoso"
  | "Inconclusivo"
  | "SemTexto";

export type TipoFonte = "Academica" | "Noticiario" | "Mista";

/** Cited sources are only ever Tier 1 or 2; Tier 3 is never cited (see CONTEXT.md). */
export type SourceEtapa = 1 | 2;

export type VerificarSource = {
  title: string;
  url: string;
  etapa: SourceEtapa;
};

export type VerificarResult = {
  decomposicao: string;
  fatosVsNarrativa: string;
  tipoFonte: TipoFonte;
  etapaUtilizada: Etapa;
  penalizacaoAplicada: boolean;
  justificativaPenalizacao: string;
  score: number;
  status: VerificarStatus;
  summary: string;
  sources: VerificarSource[];
};

// ───────────────────────────────────────────────
// FONTES PERMITIDAS — Etapas 1 e 2 com allowlist; Etapa 3 por exclusão
// ───────────────────────────────────────────────
const FONTES_PERMITIDAS = {
  etapa1: {
    etapa: 1,
    rotulo: "Científica / Acadêmica / Oficial",
    dominios: [
      { nome: "Google Scholar", url: "https://scholar.google.com" },
      { nome: "SciELO", url: "https://www.scielo.br" },
      { nome: "Periódicos CAPES", url: "https://www.periodicos.capes.gov.br" },
      { nome: "IBGE", url: "https://www.ibge.gov.br" },
      { nome: "PubMed", url: "https://pubmed.ncbi.nlm.nih.gov" },
      { nome: "Fiocruz", url: "https://portal.fiocruz.br" },
      { nome: "IPEA", url: "https://www.ipea.gov.br" },
      { nome: "Portais oficiais .gov.br", url: "https://www.gov.br" },
      { nome: "OMS (WHO)", url: "https://www.who.int" },
    ],
  },
  etapa2: {
    etapa: 2,
    rotulo: "Jornalística e de checagem (fact-checking)",
    dominios: [
      { nome: "G1", url: "https://g1.globo.com" },
      { nome: "Folha de S.Paulo", url: "https://www.folha.uol.com.br" },
      { nome: "O Estado de S. Paulo", url: "https://www.estadao.com.br" },
      { nome: "O Globo", url: "https://oglobo.globo.com" },
      { nome: "Reuters", url: "https://www.reuters.com" },
      { nome: "BBC Brasil", url: "https://www.bbc.com/portuguese" },
      { nome: "CNN Brasil", url: "https://www.cnnbrasil.com.br" },
      { nome: "Agência Lupa", url: "https://lupa.uol.com.br" },
      { nome: "Aos Fatos", url: "https://www.aosfatos.org" },
      { nome: "Projeto Comprova", url: "https://projetocomprova.com.br" },
      { nome: "AFP Checamos", url: "https://checamos.afp.com" },
      { nome: "Agência Pública", url: "https://apublica.org" },
      { nome: "Snopes", url: "https://www.snopes.com" },
    ],
  },
  // Etapa 3 NÃO é uma allowlist: é tudo o que não está nas Etapas 1 e 2
  // (blogs, redes sociais, sites pessoais, fóruns, domínios desconhecidos).
  // NUNCA é citada em "sources"; serve apenas para REDUZIR o score.
  etapa3: {
    etapa: 3,
    rotulo: "Não confiável (blogs, redes sociais, domínios desconhecidos)",
    dominios: [], // definido por exclusão — sem allowlist
  },
} as const;

// Formats a tier's label + domain list into readable text inside the prompt body.
function renderEtapa(etapa: {
  etapa: number;
  rotulo: string;
  dominios: ReadonlyArray<{ nome: string; url: string }>;
}): string {
  const linhas = etapa.dominios
    .map((d) => `  - ${d.nome} (${d.url})`)
    .join("\n");
  return `ETAPA ${etapa.etapa} — ${etapa.rotulo} (fontes permitidas):\n${linhas}`;
}

// ───────────────────────────────────────────────
// SYSTEM PROMPT
// ───────────────────────────────────────────────
const SYSTEM_PROMPT = `
Você é um auditor de fact-checking científico e jornalístico altamente rigoroso.
Sua análise DEVE usar a Busca do Google, mas você só pode CITAR fontes das
Etapas 1 e 2 listadas abaixo. A data atual é {DATA_ATUAL} — use-a para ancorar a
recência das informações: não trate eventos recentes como se estivessem no futuro,
nem como passado distante.

HIERARQUIA DE PESQUISA EM ETAPAS (percorra EM ORDEM):
- Comece SEMPRE pela ETAPA 1.
- Só avance para a etapa seguinte se NÃO encontrar informação suficiente para
  verificar a alegação na etapa atual.
- Registre em 'etapaUtilizada' o número da etapa onde a verificação foi
  efetivamente fundamentada.

${renderEtapa(FONTES_PERMITIDAS.etapa1)}

${renderEtapa(FONTES_PERMITIDAS.etapa2)}

ETAPA 3 — FONTES NÃO CONFIÁVEIS (blogs, redes sociais, sites pessoais, fóruns e
qualquer domínio fora das Etapas 1 e 2):
- NUNCA cite nem inclua essas fontes em 'sources'.
- Elas servem APENAS como sinal negativo: se a alegação só aparece em fontes
  deste tipo, ou é inflada/distorcida por elas, REDUZA o score.

REGRA DE EXCLUSIVIDADE DE FONTES (OBRIGATÓRIA):
- 'sources' só pode conter URLs das Etapas 1 e 2.
- É PROIBIDO citar Wikipédia, redes sociais, blogs ou qualquer domínio não listado.
- Se, após percorrer as etapas, NENHUMA fonte das Etapas 1 ou 2 confirmar ou
  refutar a alegação, retorne status "Inconclusivo", score baixo e explique em
  'summary' que não foi possível verificar dentro das fontes permitidas.

COMO PONTUAR (a nota DEVE variar conforme):
- a ETAPA das fontes que sustentam a alegação (Etapa 1 vale mais que Etapa 2);
- a QUANTIDADE de fontes permitidas que CONFIRMAM vs. REFUTAM a alegação;
- a presença de fontes da Etapa 3 contradizendo ou inflando a alegação (puxa o
  score para baixo, sem ser citada).

REGRA DE PENALIZAÇÃO POR VIÉS POLÍTICO:
- ETAPA 1 (científica/oficial): sem penalização — a precisão pode chegar a 100%.
- ETAPA 2 (jornalística/checagem): tem linha editorial e potencial viés.
  - Verificação que depende PARCIALMENTE da Etapa 2: reduza 'score' em 15%.
  - Verificação 100% dependente da Etapa 2: reduza 'score' em 30% (teto de 70).
- 'tipoFonte': "Academica" se a base foi a Etapa 1; "Noticiario" se foi a Etapa 2;
  "Mista" se combinou Etapa 1 com Etapa 2.
- Em 'justificativaPenalizacao', explique o motivo e a porcentagem deduzida, ou
  justifique por que a nota foi mantida (base científica). Escreva como legenda
  para o usuário, no estilo: "Confiável: artigos passam por revisão por pares" ou
  "Parcial: portais de notícia apresentam viés editorial".

REGRA DE CLASSIFICAÇÃO E PORCENTAGEM (OBRIGATÓRIO):
Defina 'score' e 'status' ESTRITAMENTE dentro destas faixas:
1. 0 a 44 (Falso ou Enganoso): sustentado apenas por fontes da Etapa 3, ou
   refutado por fontes das Etapas 1/2.
2. 45 a 74 (Inconclusivo ou Enganoso): fontes mistas com controvérsias. O status
   NUNCA pode ser "Verdadeiro" nesta faixa.
3. 75 a 100 (Verdadeiro): corroborado por fontes da Etapa 1 (e, se houver, Etapa 2).

ANÁLISE DE IMAGEM:
- Analise a(s) imagem(ns) lendo principalmente o TEXTO e as alegações nela(s)
  contidas.
- Se a(s) imagem(ns) NÃO contiver(em) nenhum texto legível, NÃO tente analisar nem
  inventar um veredito: retorne EXCLUSIVAMENTE o status "SemTexto". Esse status é
  um sinal para o sistema exibir a tela de erro — não preencha 'score', 'sources'
  nem 'summary' com análise.
`.trim();

// ───────────────────────────────────────────────
// CONTRATO DE SAÍDA (parseado manualmente — grounding é incompatível com schema)
// ───────────────────────────────────────────────
const JSON_CONTRACT = `{
  "decomposicao": "<decomposição da alegação em afirmações verificáveis>",
  "fatosVsNarrativa": "<separação entre fatos objetivos e narrativa/opinião>",
  "tipoFonte": "Academica" | "Noticiario" | "Mista",
  "etapaUtilizada": <1 | 2 | 3>,
  "penalizacaoAplicada": true | false,
  "justificativaPenalizacao": "<motivo e % deduzida, ou justificativa da manutenção, em linguagem de legenda para o usuário>",
  "score": <número inteiro 0-100, JÁ com a penalização aplicada>,
  "status": "Verdadeiro" | "Falso" | "Enganoso" | "Inconclusivo" | "SemTexto",
  "summary": "<análise em 3 a 5 frases em português, explicando por que chegou a esse score e citando o tipo das fontes>",
  "sources": [
    { "title": "<nome da fonte>", "url": "<URL real, somente Etapas 1 ou 2>", "etapa": <1 | 2> }
  ]
}`;
// Observação: "SemTexto" é um status-sentinela usado SOMENTE quando a imagem não
// tem texto legível. Nesse caso, apenas 'status' precisa vir preenchido.

const FORMATO = `Retorne APENAS um objeto JSON com esta estrutura exata, sem markdown e sem blocos de código:
${JSON_CONTRACT}

score 0 = completamente falso/enganoso; 100 = completamente verdadeiro/confiável.`;

// ───────────────────────────────────────────────
// Instrução por tipo de entrada (anexada após SYSTEM_PROMPT + FORMATO)
// ───────────────────────────────────────────────
// IMAGEM: `Analise a(s) imagem(ns) a seguir quanto à veracidade, lendo principalmente o texto/alegações presentes. ${FORMATO}`
// TEXTO:  `Analise o seguinte texto quanto à veracidade. ${FORMATO}\n\nTexto: {conteudo}`
// LINK:   `Analise a notícia no seguinte link quanto à veracidade. ${FORMATO}\n\nURL: {conteudo}`

// ───────────────────────────────────────────────
// Allowlist de domínios (Etapas 1 e 2) para casar com os URIs do grounding
// ───────────────────────────────────────────────
// Matching is host-level (and subdomain-level): a path in an allowlist entry
// (e.g. bbc.com/portuguese) is NOT enforced, and the broad ".gov.br" entry
// subsumes the specific .gov.br entries (IBGE, IPEA, CAPES) for matching —
// those remain listed because they appear by name in the prompt text.
type DominioPermitido = { host: string; etapa: SourceEtapa };

const DOMINIOS_PERMITIDOS: DominioPermitido[] = [
  ...FONTES_PERMITIDAS.etapa1.dominios.map((d) => ({
    host: hostnameOf(d.url),
    etapa: 1 as const,
  })),
  ...FONTES_PERMITIDAS.etapa2.dominios.map((d) => ({
    host: hostnameOf(d.url),
    etapa: 2 as const,
  })),
];

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Returns the etapa (1 or 2) for a resolved hostname, or null if it is Tier 3. */
function matchEtapa(hostname: string): SourceEtapa | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const allowed of DOMINIOS_PERMITIDOS) {
    if (!allowed.host) continue;
    if (host === allowed.host || host.endsWith(`.${allowed.host}`))
      return allowed.etapa;
  }
  return null;
}

// ───────────────────────────────────────────────
// Helpers de parsing defensivo
// ───────────────────────────────────────────────
const VALID_STATUS: VerificarStatus[] = [
  "Verdadeiro",
  "Falso",
  "Enganoso",
  "Inconclusivo",
  "SemTexto",
];
const VALID_TIPO_FONTE: TipoFonte[] = ["Academica", "Noticiario", "Mista"];

// Grounding chunks to attempt to resolve vs. sources ultimately cited.
const MAX_GROUNDING_CANDIDATES = 15;
const MAX_CITED_SOURCES = 8;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBool(value: unknown): boolean {
  return value === true;
}

/** Locates the JSON object inside the model's text response and parses it defensively. */
function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) {
    throw new Error(`No JSON found in Gemini response: ${raw.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(
      `Malformed JSON in Gemini response: ${raw.slice(start, start + 200)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Gemini response JSON is not an object");
  }
  return parsed as Record<string, unknown>;
}

function parseDataUrl(dataUrl: string): { data: string; mimeType: string } {
  // Require a real "data:" URL so non-image junk never reaches the model.
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Imagem em formato inválido (data URL esperado)");
  const mimeType = match[1] || "image/jpeg";
  const data = match[2];
  if (!data) throw new Error("Imagem vazia");
  return { data, mimeType };
}

// ───────────────────────────────────────────────
// Server function
// ───────────────────────────────────────────────
export const verificarNoticia = createServerFn({ method: "POST" })
  .validator((data: VerificarInput) => data)
  .handler(async ({ data }): Promise<VerificarResult> => {
    const { inputType } = data;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey)
      throw new Error("GEMINI_API_KEY is not configured on the server");

    const ai = new GoogleGenAI({ apiKey });

    // Date anchoring: carry the real server date into the prompt so the model
    // judges recency correctly instead of treating recent events as future/past.
    const dataAtual = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
    }).format(new Date());
    const systemPrompt = SYSTEM_PROMPT.replace("{DATA_ATUAL}", dataAtual);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let contents: any;

    if (inputType === "image") {
      // `images` is the canonical contract (1–3 data URLs). The single-string
      // `inputValue` fallback is a transitional shim for the current frontend,
      // which still sends one image via inputValue; it can be removed once the
      // frontend image work lands and sends `images`.
      const images = data.images?.length
        ? data.images
        : data.inputValue
          ? [data.inputValue]
          : [];
      if (images.length < 1 || images.length > 3) {
        throw new Error("São necessárias de 1 a 3 imagens.");
      }
      const imageParts = images.map((image) => {
        const { data: base64Data, mimeType } = parseDataUrl(image);
        return { inlineData: { data: base64Data, mimeType } };
      });
      const instrucao = `Analise a(s) imagem(ns) a seguir quanto à veracidade, lendo principalmente o texto/alegações presentes. ${FORMATO}`;
      contents = [
        {
          role: "user",
          parts: [...imageParts, { text: `${systemPrompt}\n\n${instrucao}` }],
        },
      ];
    } else {
      const conteudo = (data.inputValue ?? "").trim();
      if (!conteudo) throw new Error("Conteúdo vazio para verificação.");
      const instrucao =
        inputType === "link"
          ? `Analise a notícia no seguinte link quanto à veracidade. ${FORMATO}\n\nURL: ${conteudo}`
          : `Analise o seguinte texto quanto à veracidade. ${FORMATO}\n\nTexto: ${conteudo}`;
      contents = `${systemPrompt}\n\n${instrucao}`;
    }

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents,
      // Google Search grounding. Incompatible with a structured responseSchema on
      // this model, so the JSON contract is enforced via the prompt and parsed
      // manually below.
      config: { tools: [{ googleSearch: {} }] },
    });

    const raw = response.text;
    if (!raw) throw new Error("Empty response from Gemini");

    const parsed = extractJsonObject(raw);

    // Parse status FIRST. "SemTexto" is a sentinel (image had no readable text):
    // short-circuit to the error condition WITHOUT running grounding resolution,
    // liveness checks or scoring. This is distinct from "Inconclusivo", which is
    // a legitimate verdict shown on the result screen.
    const rawStatus = asString(parsed.status);
    if (rawStatus === "SemTexto") {
      throw new Error(
        "SEM_TEXTO: a(s) imagem(ns) não contém texto legível para análise.",
      );
    }

    // Sources come from the grounding metadata (what Search actually retrieved),
    // not from URLs the model writes free-form — this is what eliminates
    // fabricated/dead links. Match each grounded URI to the Tier 1/2 allowlist,
    // resolve+HEAD-check it (dropping Tier 3 and dead links), and tag its etapa.
    const sources = await buildSources(response);

    const rawScore = Math.round(Number(parsed.score));
    const scoreValid = Number.isFinite(rawScore);
    const score = scoreValid ? Math.max(0, Math.min(100, rawScore)) : 0;

    // A malformed/missing score must never surface as a confident verdict
    // (without this, an unparseable score would read as 0 = "completely false").
    const status: VerificarStatus =
      scoreValid && VALID_STATUS.includes(rawStatus as VerificarStatus)
        ? (rawStatus as VerificarStatus)
        : "Inconclusivo";

    const rawEtapa = Number(parsed.etapaUtilizada);
    const etapaUtilizada: Etapa =
      rawEtapa === 1 || rawEtapa === 2 || rawEtapa === 3 ? rawEtapa : 3;

    const rawTipo = asString(parsed.tipoFonte);
    const tipoFonte: TipoFonte = VALID_TIPO_FONTE.includes(rawTipo as TipoFonte)
      ? (rawTipo as TipoFonte)
      : "Mista";

    return {
      decomposicao: asString(parsed.decomposicao),
      fatosVsNarrativa: asString(parsed.fatosVsNarrativa),
      tipoFonte,
      etapaUtilizada,
      penalizacaoAplicada: asBool(parsed.penalizacaoAplicada),
      justificativaPenalizacao: asString(parsed.justificativaPenalizacao),
      score,
      status,
      summary: asString(parsed.summary),
      sources,
    };
  });

/**
 * Builds the cited source list from Google Search grounding metadata:
 * resolve each grounded URI (a Search redirect) to its real publisher URL,
 * keep only live Tier 1/2 domains, and tag each with its etapa. Tier 3 and
 * dead links never appear.
 */
async function buildSources(response: {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
}): Promise<VerificarSource[]> {
  const chunks =
    response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const candidates = chunks
    .map((chunk) => chunk.web)
    .filter(
      (web): web is { uri?: string; title?: string } =>
        !!web && typeof web.uri === "string",
    )
    .slice(0, MAX_GROUNDING_CANDIDATES); // only a handful of allowed domains will survive

  const resolved = await mapWithConcurrency(
    candidates,
    MAX_CONCURRENCY,
    async (web) => {
      const live = await resolveLiveUrl(web.uri as string);
      if (!live) return null;
      const etapa = matchEtapa(live.hostname);
      if (etapa === null) return null; // Tier 3 — never cited
      const title =
        (web.title ?? "").trim() || live.hostname.replace(/^www\./, "");
      return { title, url: live.url, etapa };
    },
  );

  const sources: VerificarSource[] = [];
  const seen = new Set<string>();
  for (const source of resolved) {
    if (!source) continue;
    if (seen.has(dedupeKey(source.url))) continue;
    seen.add(dedupeKey(source.url));
    sources.push(source);
    if (sources.length >= MAX_CITED_SOURCES) break;
  }

  // Observability: grounding returned references but none survived tier+liveness
  // filtering. Most often this means the Search redirect URIs did not resolve to
  // a real publisher host — worth noticing rather than silently returning [].
  if (candidates.length > 0 && sources.length === 0) {
    console.warn(
      `[verificar] ${candidates.length} grounding chunk(s) but 0 cited sources after tier/liveness filtering`,
    );
  }

  return sources;
}

/** Normalizes a URL for de-duplication: drops hash, trailing slash and tracking query. */
function dedupeKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    u.search = "";
    return `${u.host}${u.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}
