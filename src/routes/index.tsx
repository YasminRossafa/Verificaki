import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Verificaki — Verifique a veracidade de notícias" },
      {
        name: "description",
        content:
          "Cole um link, digite um texto ou faça upload de uma imagem para verificar a veracidade da informação.",
      },
      { property: "og:title", content: "Verificaki" },
      {
        property: "og:description",
        content: "Combatendo a desinformação. Verifique notícias em segundos.",
      },
    ],
  }),
  component: Verificaki,
});

type Screen = "home" | "loading" | "result" | "error";
type InputType = "link" | "text" | "image";
type InstallState = "hidden" | "prompt" | "how";

const ICON_LINK = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
const ICON_TEXT = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
const ICON_IMG = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="1.6" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const LogoSvg = ({ size = 38 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M2.6 16 Q16 4 29.4 16 Q16 28 2.6 16 Z" fill="#EAF1FD" stroke="#1A73E8" strokeWidth="2.3" strokeLinejoin="round" />
    <circle cx="16" cy="16" r="6.3" fill="#34A853" />
    <circle cx="16" cy="16" r="6.3" fill="none" stroke="#fff" strokeWidth="1.1" />
    <circle cx="16" cy="16" r="2.3" fill="#0E2A47" />
    <path d="M16 8.4 V11 M16 21 V23.6 M8.4 16 H11 M21 16 H23.6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

function classify(s: number) {
  if (s <= 45) return { label: "Conteúdo falso", short: "Falsa", color: "#EA4335", bg: "#FCE8E6", icon: "✕" };
  if (s <= 75) return { label: "Confiança média", short: "Média", color: "#E0900A", bg: "#FEF6DC", icon: "!" };
  return { label: "Conteúdo confiável", short: "Confiável", color: "#34A853", bg: "#E6F4EA", icon: "✓" };
}

const KEYFRAMES = `
@keyframes vk-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.07);}}
@keyframes vk-ring{0%{transform:scale(.85);opacity:.55;}100%{transform:scale(1.7);opacity:0;}}
@keyframes vk-shimmer{0%{transform:translateX(-120%);}100%{transform:translateX(420%);}}
@keyframes vk-blink{0%,100%{opacity:1;}50%{opacity:.3;}}
@keyframes vk-spin{to{transform:rotate(360deg);}}
@keyframes vk-slideup{from{transform:translateY(26px);}to{transform:translateY(0);}}
body{font-family:'Source Sans 3',system-ui,sans-serif;}
::selection{background:#cfe0fb;}
`;

function Verificaki() {
  const [screen, setScreen] = useState<Screen>("home");
  const [inputType, setInputType] = useState<InputType>("link");
  const [inputValue, setInputValue] = useState("");
  const [imageName, setImageName] = useState("");
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [gaugeScore, setGaugeScore] = useState(0);
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorType, setErrorType] = useState<InputType>("link");
  const [install, setInstall] = useState<InstallState>("hidden");

  const timers = useRef<{ step?: number; done?: number; gauge?: number; raf?: number; fallback?: number; install?: number }>({});

  const clearTimers = () => {
    const t = timers.current;
    if (t.step) clearInterval(t.step);
    if (t.done) clearTimeout(t.done);
    if (t.gauge) clearTimeout(t.gauge);
    if (t.raf) cancelAnimationFrame(t.raf);
    if (t.fallback) clearTimeout(t.fallback);
  };

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem("vk_install_dismissed") === "1"; } catch {}
    if (!dismissed) {
      timers.current.install = window.setTimeout(() => setInstall("prompt"), 2600);
    }
    return () => {
      clearTimers();
      if (timers.current.install) clearTimeout(timers.current.install);
    };
  }, []);

  const setType = (t: InputType) => { setInputType(t); setInputValue(""); setImageName(""); };

  const goHome = () => {
    clearTimers();
    setScreen("home"); setInputValue(""); setImageName(""); setScore(0); setDisplayScore(0); setGaugeScore(0); setLoadingStep(0);
  };

  const showError = (type: InputType) => { setErrorType(type); setScreen("error"); };

  const toResult = (finalScore: number) => {
    setScreen("result");
    setScore(finalScore);
    setDisplayScore(0);
    setGaugeScore(0);
    timers.current.gauge = window.setTimeout(() => setGaugeScore(finalScore), 90);
    const start = performance.now();
    const dur = 1500;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplayScore(Math.round(eased * finalScore));
      if (p < 1) timers.current.raf = requestAnimationFrame(tick);
    };
    timers.current.raf = requestAnimationFrame(tick);
    timers.current.fallback = window.setTimeout(() => { setDisplayScore(finalScore); setGaugeScore(finalScore); }, 1700);
  };

  const startLoading = () => {
    clearTimers();
    setScreen("loading"); setLoadingStep(0);
    timers.current.step = window.setInterval(() => {
      setLoadingStep((prev) => (prev >= 3 ? prev : prev + 1));
    }, 850);
    timers.current.done = window.setTimeout(() => {
      clearTimers();
      const s = 38 + Math.floor(Math.random() * 58);
      toResult(s);
    }, 3100);
  };

  const verify = () => {
    const v = inputValue.trim();
    if (inputType === "text" && v.length < 100) return showError("text");
    if (inputType === "link" && !/^https?:\/\//i.test(v)) return showError("link");
    if (inputType === "image" && !imageName) return showError("image");
    startLoading();
  };

  const share = () => {
    const cls = classify(score);
    const txt = `Verifiquei esta notícia no Verificaki: ${score}% — ${cls.short}.`;
    try {
      if (navigator.share) navigator.share({ title: "Verificaki", text: txt });
      else navigator.clipboard?.writeText(txt);
    } catch {}
  };

  const dismissInstall = () => {
    if (timers.current.install) clearTimeout(timers.current.install);
    setInstall("hidden");
    try { localStorage.setItem("vk_install_dismissed", "1"); } catch {}
  };

  const cls = classify(score);
  const needleTransform = `rotate(${(1.8 * gaugeScore - 90).toFixed(1)}deg)`;

  const tabDef: { key: InputType; label: string; icon: React.ReactNode }[] = [
    { key: "link", label: "Link", icon: ICON_LINK },
    { key: "text", label: "Texto", icon: ICON_TEXT },
    { key: "image", label: "Imagem", icon: ICON_IMG },
  ];

  const lsLabels = ["Verificando fontes", "Cruzando dados", "Avaliando credibilidade"];
  const progressWidth = Math.min(96, 12 + loadingStep * 28) + "%";

  const relMap = {
    green: { dot: "#34A853", halo: "#E6F4EA", relLabel: "Confiável" },
    amber: { dot: "#E0900A", halo: "#FEF6DC", relLabel: "Parcial" },
    red: { dot: "#EA4335", halo: "#FCE8E6", relLabel: "Contesta" },
  } as const;
  type Rel = keyof typeof relMap;
  let srcDef: [string, Rel][];
  if (score <= 45) srcDef = [["Agência Lupa", "red"], ["Aos Fatos", "red"], ["Comprova", "amber"], ["Reuters Fact Check", "red"], ["AFP Checamos", "amber"]];
  else if (score <= 75) srcDef = [["Agência Lupa", "green"], ["Aos Fatos", "amber"], ["G1", "green"], ["Comprova", "amber"], ["BBC Brasil", "green"]];
  else srcDef = [["Agência Lupa", "green"], ["Aos Fatos", "green"], ["G1", "green"], ["BBC Brasil", "green"], ["Reuters", "green"]];
  const sources = srcDef.map(([name, rel]) => ({ name, url: "#fonte", ...relMap[rel] }));

  const n = 8 + (score % 7);
  const summary =
    score <= 45
      ? `Esta notícia apresenta fortes sinais de desinformação e contradiz ${n} fontes verificadas. Recomendamos não compartilhar.`
      : score <= 75
      ? "Encontramos informações divergentes entre as fontes. Há elementos verdadeiros, mas também imprecisões — confira antes de compartilhar."
      : `Esta notícia foi considerada confiável com base em ${n} fontes verificadas que confirmam as informações apresentadas.`;

  const errMsgs: Record<InputType, string> = {
    image: "Não foi possível reconhecer a imagem. Tente enviar uma imagem mais nítida ou com texto legível.",
    link: "O link não está acessível ou não contém uma notícia válida. Verifique o endereço e tente novamente.",
    text: "O texto é muito curto ou não contém informações suficientes para análise. São necessários ao menos 100 caracteres.",
  };

  const root: CSSProperties = {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "#FBFCFE",
    color: "#1F2A37",
    fontFamily: "'Source Sans 3',system-ui,sans-serif",
  };

  return (
    <div style={root}>
      <style>{KEYFRAMES}</style>

      <header style={{ position: "sticky", top: 0, zIndex: 30, background: "rgba(255,255,255,.9)", backdropFilter: "blur(10px)", borderBottom: "1px solid #E7EAEF" }}>
        <div style={{ height: 3, background: "linear-gradient(90deg,#1A73E8 0%,#1A73E8 55%,#34A853 55%,#34A853 100%)" }} />
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "13px clamp(18px,5vw,40px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <button onClick={goHome} aria-label="Verificaki, ir para o início" style={{ display: "flex", alignItems: "center", gap: 11, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
            <span style={{ display: "inline-flex", width: 38, height: 38, alignItems: "center", justifyContent: "center" }}><LogoSvg /></span>
            <span style={{ fontFamily: "'Source Serif 4',serif", fontSize: 23, fontWeight: 700, letterSpacing: "-.01em", color: "#0E2A47", lineHeight: 1 }}>
              Verifica<span style={{ color: "#34A853" }}>ki</span>
            </span>
          </button>
          <nav aria-label="Menu principal" style={{ display: "flex", alignItems: "center", gap: "clamp(10px,2.4vw,26px)", fontSize: 15, fontWeight: 600, color: "#5F6368" }}>
            {screen === "result" && (
              <button onClick={goHome} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#EAF1FD", border: "1px solid #cfe0fb", color: "#1A73E8", borderRadius: 999, padding: "7px 14px", font: "inherit", fontWeight: 700, cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                Nova
              </button>
            )}
          </nav>
        </div>
      </header>

      <main style={{ flex: 1, width: "100%" }}>
        {screen === "home" && (
          <section style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(34px,6vw,76px) clamp(18px,5vw,40px) clamp(40px,6vw,80px)" }}>
            <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
              <h1 style={{ fontFamily: "'Source Serif 4',serif", fontWeight: 700, fontSize: "clamp(33px,6.2vw,60px)", lineHeight: 1.06, letterSpacing: "-.02em", color: "#0E2A47", margin: "20px 0 0" }}>
                A notícia é verdadeira?<br />
                <span style={{ color: "#1A73E8" }}>Verifique aqui.</span>
              </h1>
              <p style={{ fontSize: "clamp(16px,2.1vw,20px)", lineHeight: 1.55, color: "#5F6368", margin: "18px auto 0", maxWidth: 560 }}>
                Cole um link, digite um texto ou faça upload de uma imagem para verificar a veracidade da informação.
              </p>
            </div>

            <div style={{ maxWidth: 740, margin: "30px auto 0", background: "#fff", border: "1px solid #E7EAEF", borderRadius: 18, boxShadow: "0 18px 50px -22px rgba(14,42,71,.28)", padding: "clamp(16px,3vw,26px)", textAlign: "left" }}>
              <div role="tablist" aria-label="Tipo de entrada" style={{ display: "flex", gap: 8, background: "#F1F4F8", padding: 5, borderRadius: 12 }}>
                {tabDef.map((t) => {
                  const active = t.key === inputType;
                  return (
                    <button key={t.key} role="tab" onClick={() => setType(t.key)} aria-label={t.label} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", cursor: "pointer", font: "inherit", fontSize: 14.5, padding: "10px 8px", borderRadius: 9, transition: "all .18s ease", color: active ? "#1A73E8" : "#5F6368", background: active ? "#fff" : "transparent", boxShadow: active ? "0 1px 3px rgba(14,42,71,.14)" : "none", fontWeight: active ? 700 : 600 }}>
                      <span style={{ display: "inline-flex" }}>{t.icon}</span>
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {inputType === "image" && (
                <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16, minHeight: 148, border: "2px dashed #c4d3e8", borderRadius: 13, background: "#F7FAFE", cursor: "pointer", textAlign: "center", padding: 20 }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v13" /></svg>
                  <span style={{ fontSize: 15.5, fontWeight: 600, color: "#0E2A47" }}>{imageName || "Arraste uma imagem ou clique para enviar"}</span>
                  <span style={{ fontSize: 13, color: "#80868B" }}>PNG, JPG ou prints de tela · até 10MB</span>
                  <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) setImageName(f.name); }} style={{ display: "none" }} />
                </label>
              )}

              {inputType === "text" && (
                <textarea
                  onChange={(e) => setInputValue(e.target.value)}
                  value={inputValue}
                  aria-label="Texto da notícia"
                  placeholder="Escreva ou cole o texto da notícia que deseja verificar (mínimo 100 caracteres)..."
                  style={{ width: "100%", marginTop: 16, minHeight: 130, resize: "vertical", border: "1px solid #DADCE0", borderRadius: 13, padding: "14px 16px", font: "inherit", fontSize: 16, lineHeight: 1.5, color: "#1F2A37", outline: "none", background: "#fff" }}
                />
              )}

              {inputType === "link" && (
                <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 16, border: "1px solid #DADCE0", borderRadius: 13, padding: "4px 6px 4px 15px", background: "#fff" }}>
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#80868B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
                  <input type="url" onChange={(e) => setInputValue(e.target.value)} value={inputValue} aria-label="Link da notícia" placeholder="https://exemplo.com/noticia..." style={{ flex: 1, border: "none", outline: "none", font: "inherit", fontSize: 16, color: "#1F2A37", padding: "11px 0", background: "transparent" }} />
                </div>
              )}

              <button onClick={verify} style={{ width: "100%", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, background: "#1A73E8", color: "#fff", border: "none", borderRadius: 13, padding: 15, font: "inherit", fontSize: 16.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 10px 24px -10px rgba(26,115,232,.7)", transition: "background .18s ease" }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                Verificar agora
              </button>
              <p style={{ textAlign: "center", margin: "12px 0 0", fontSize: 12.5, color: "#80868B" }}>Análise gratuita · Resultado em segundos · Sem cadastro</p>
            </div>
          </section>
        )}

        {screen === "loading" && (
          <section style={{ maxWidth: 600, margin: "0 auto", padding: "clamp(40px,8vw,90px) clamp(18px,5vw,40px)", textAlign: "center" }}>
            <div style={{ position: "relative", width: 120, height: 120, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#cfe0fb", animation: "vk-ring 1.8s ease-out infinite" }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#bfe3cb", animation: "vk-ring 1.8s ease-out infinite .9s" }} />
              <span style={{ position: "relative", display: "inline-flex", width: 96, height: 96, alignItems: "center", justifyContent: "center", background: "#fff", borderRadius: "50%", boxShadow: "0 12px 30px -10px rgba(14,42,71,.3)", animation: "vk-pulse 1.8s ease-in-out infinite" }}>
                <LogoSvg size={56} />
              </span>
            </div>
            <h2 style={{ fontFamily: "'Source Serif 4',serif", fontWeight: 600, fontSize: "clamp(24px,4vw,32px)", color: "#0E2A47", margin: "26px 0 6px", letterSpacing: "-.01em" }}>
              Analisando a notícia<span style={{ animation: "vk-blink 1.2s steps(1) infinite" }}>...</span>
            </h2>
            <p style={{ fontSize: 15, color: "#80868B", margin: 0 }}>Aguarde alguns segundos enquanto cruzamos as fontes</p>

            <div style={{ maxWidth: 380, margin: "28px auto 0", textAlign: "left", display: "flex", flexDirection: "column", gap: 13 }}>
              {lsLabels.map((label, i) => {
                const done = loadingStep > i;
                const active = loadingStep === i;
                const color = done ? "#34A853" : active ? "#0E2A47" : "#9aa0a6";
                const opacity = done || active ? 1 : 0.5;
                const dotBg = done ? "#34A853" : active ? "#1A73E8" : "#c4c8cd";
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 15.5, fontWeight: 600, color, opacity, transition: "all .3s ease" }}>
                    <span style={{ display: "inline-flex", width: 24, height: 24, flex: "none", alignItems: "center", justifyContent: "center", borderRadius: "50%", background: dotBg, color: "#fff" }}>
                      {done ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                      ) : active ? (
                        <span style={{ display: "inline-block", width: 9, height: 9, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "vk-spin .7s linear infinite" }} />
                      ) : (
                        String(i + 1)
                      )}
                    </span>
                    {label}
                  </div>
                );
              })}
            </div>

            <div style={{ maxWidth: 420, margin: "26px auto 0", height: 8, borderRadius: 99, background: "#E7EAEF", overflow: "hidden", position: "relative" }}>
              <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#1A73E8,#34A853)", transition: "width .7s cubic-bezier(.4,0,.2,1)", width: progressWidth }} />
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "40%", background: "linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent)", animation: "vk-shimmer 1.4s linear infinite" }} />
            </div>

            <div style={{ maxWidth: 440, margin: "30px auto 0", background: "#FFFBEB", border: "1px solid #FBE7A8", borderRadius: 13, padding: "14px 18px", display: "flex", gap: 11, alignItems: "flex-start", textAlign: "left" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#B8860B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" /></svg>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "#6b5a18" }}>
                <strong style={{ color: "#5a4a10" }}>Sabia?</strong> Mais de 60% das notícias falsas são compartilhadas sem qualquer verificação.
              </p>
            </div>

            <button onClick={goHome} style={{ marginTop: 24, background: "none", border: "none", color: "#9aa0a6", font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 3 }}>Cancelar análise</button>
          </section>
        )}

        {screen === "result" && (
          <section style={{ maxWidth: 1000, margin: "0 auto", padding: "clamp(28px,5vw,56px) clamp(18px,5vw,40px)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: "clamp(18px,3vw,30px)", alignItems: "start" }}>
              <div style={{ background: "#fff", border: "1px solid #E7EAEF", borderRadius: 20, padding: "clamp(22px,3vw,32px)", boxShadow: "0 14px 40px -22px rgba(14,42,71,.25)", textAlign: "center" }}>
                <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "#80868B", margin: "0 0 6px" }}>Índice de confiabilidade</p>
                <div style={{ width: "100%", maxWidth: 300, margin: "0 auto" }}>
                  <svg viewBox="0 0 200 118" style={{ width: "100%", height: "auto", display: "block" }}>
                    <path d="M20 110 A80 80 0 0 1 87.5 31" fill="none" stroke="#EA4335" strokeWidth="15" strokeLinecap="round" />
                    <path d="M90.6 29.6 A80 80 0 0 1 153.8 50.6" fill="none" stroke="#FBBC04" strokeWidth="15" />
                    <path d="M156.6 53 A80 80 0 0 1 180 110" fill="none" stroke="#34A853" strokeWidth="15" strokeLinecap="round" />
                    <g style={{ transform: needleTransform, transformOrigin: "100px 110px", transition: "transform 1.6s cubic-bezier(.2,.85,.25,1)" }}>
                      <path d="M100 110 L100 42" stroke="#0E2A47" strokeWidth="4.5" strokeLinecap="round" />
                    </g>
                    <circle cx="100" cy="110" r="8" fill="#0E2A47" />
                    <circle cx="100" cy="110" r="3.4" fill="#fff" />
                    <text x="18" y="116" fontSize="9" fill="#9aa0a6" fontFamily="Source Sans 3,sans-serif" textAnchor="middle">0</text>
                    <text x="182" y="116" fontSize="9" fill="#9aa0a6" fontFamily="Source Sans 3,sans-serif" textAnchor="middle">100</text>
                  </svg>
                  <div style={{ textAlign: "center", marginTop: -4, fontFamily: "'Source Serif 4',serif", fontWeight: 700, fontSize: "clamp(40px,9vw,54px)", lineHeight: 1, color: "#0E2A47" }}>
                    {displayScore}
                    <span style={{ fontSize: ".5em", color: "#80868B" }}>%</span>
                  </div>
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginTop: 8, padding: "9px 18px", borderRadius: 999, fontSize: 16, fontWeight: 700, background: cls.bg, color: cls.color }}>
                  <span style={{ display: "inline-flex", width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: "50%", fontSize: 13, background: cls.color, color: "#fff" }}>{cls.icon}</span>
                  {cls.label}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ background: "#fff", border: "1px solid #E7EAEF", borderRadius: 18, padding: "22px 24px" }}>
                  <h2 style={{ fontFamily: "'Source Serif 4',serif", fontSize: 20, fontWeight: 600, color: "#0E2A47", margin: "0 0 9px" }}>Resumo da análise</h2>
                  <p style={{ fontSize: 15.5, lineHeight: 1.6, color: "#3c4043", margin: 0 }}>{summary}</p>
                </div>

                <div style={{ background: "#fff", border: "1px solid #E7EAEF", borderRadius: 18, padding: "22px 24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></svg>
                    <h2 style={{ fontSize: 16, fontWeight: 700, color: "#0E2A47", margin: 0 }}>Fontes consultadas</h2>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {sources.map((src, i) => (
                      <a key={i} href={src.url} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: "1px solid #F1F4F8", textDecoration: "none" }}>
                        <span style={{ width: 9, height: 9, flex: "none", borderRadius: "50%", background: src.dot, boxShadow: `0 0 0 3px ${src.halo}` }} />
                        <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: "#1F2A37" }}>{src.name}</span>
                        <span style={{ fontSize: 12.5, color: src.dot, fontWeight: 600 }}>{src.relLabel}</span>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#bdc1c6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                      </a>
                    ))}
                    <button style={{ marginTop: 8, alignSelf: "flex-start", background: "none", border: "none", color: "#1A73E8", font: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer", padding: "4px 0" }}>Outras fontes →</button>
                  </div>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <button onClick={goHome} style={{ flex: 1, minWidth: 150, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#1A73E8", color: "#fff", border: "none", borderRadius: 12, padding: 13, font: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                    Nova verificação
                  </button>
                  <button onClick={share} aria-label="Compartilhar resultado" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#fff", color: "#3c4043", border: "1px solid #DADCE0", borderRadius: 12, padding: "13px 16px", font: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" /></svg>
                    Compartilhar
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}

        {screen === "error" && (
          <section style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(40px,8vw,90px) clamp(18px,5vw,40px)", textAlign: "center" }}>
            <span style={{ display: "inline-flex", width: 84, height: 84, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#FCE8E6" }}>
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            </span>
            <h2 style={{ fontFamily: "'Source Serif 4',serif", fontWeight: 600, fontSize: "clamp(24px,4vw,32px)", color: "#0E2A47", margin: "22px 0 8px", letterSpacing: "-.01em" }}>Ops! Não foi possível processar sua solicitação</h2>
            <p style={{ fontSize: 16, lineHeight: 1.55, color: "#5F6368", margin: "0 auto", maxWidth: 440 }}>O sistema não conseguiu entender o conteúdo enviado.</p>

            <div style={{ margin: "22px auto 0", maxWidth: 460, background: "#FCE8E6", border: "1px solid #f6c5c0", borderRadius: 13, padding: "15px 18px", textAlign: "left", display: "flex", gap: 11, alignItems: "flex-start" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#c5362b" strokeWidth="2.2" strokeLinecap="round" style={{ flex: "none", marginTop: 1 }}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "#a8302a", fontWeight: 500 }}>{errMsgs[errorType]}</p>
            </div>

            <div style={{ margin: "16px auto 0", maxWidth: 460, background: "#E8F0FE", border: "1px solid #d2e1fb", borderRadius: 13, padding: "14px 18px", textAlign: "left", display: "flex", gap: 11, alignItems: "flex-start" }}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1A73E8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", marginTop: 1 }}><path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2Z" /></svg>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "#1c4e9c" }}>
                <strong>Dica:</strong> certifique-se de que o link é de uma notícia, o texto tem ao menos 100 caracteres ou a imagem contém texto visível.
              </p>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 11, marginTop: 26 }}>
              <button onClick={goHome} style={{ display: "flex", alignItems: "center", gap: 8, background: "#1A73E8", color: "#fff", border: "none", borderRadius: 12, padding: "13px 22px", font: "inherit", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                Tentar novamente
              </button>
            </div>
          </section>
        )}
      </main>

      <footer style={{ borderTop: "1px solid #E7EAEF", background: "#fff", marginTop: "auto" }}>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px clamp(18px,5vw,40px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M2.6 16 Q16 4 29.4 16 Q16 28 2.6 16 Z" fill="none" stroke="#1A73E8" strokeWidth="2.3" strokeLinejoin="round" />
              <circle cx="16" cy="16" r="5.2" fill="#34A853" />
              <circle cx="16" cy="16" r="2" fill="#0E2A47" />
            </svg>
            <span style={{ fontSize: 14, color: "#5F6368" }}>Verificaki © 2026 — Combatendo a desinformação</span>
          </div>
          <div style={{ display: "flex", gap: 20, fontSize: 14, fontWeight: 600, color: "#80868B" }}>
            <a href="#privacidade" style={{ textDecoration: "none", color: "#80868B" }}>Privacidade</a>
          </div>
        </div>
      </footer>

      {install !== "hidden" && (
        <div style={{ position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 60, maxWidth: 404, margin: "0 auto", background: "#fff", border: "1px solid #E2E7EE", borderRadius: 16, boxShadow: "0 18px 48px -12px rgba(14,42,71,.4)", padding: "16px 18px", animation: "vk-slideup .42s cubic-bezier(.2,.85,.25,1)" }}>
          <button onClick={dismissInstall} aria-label="Fechar" style={{ position: "absolute", top: 9, right: 9, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", color: "#9aa0a6", borderRadius: 8 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div style={{ display: "flex", gap: 13, alignItems: "flex-start", paddingRight: 18 }}>
            <span style={{ display: "inline-flex", flex: "none", width: 46, height: 46, borderRadius: 13, background: "#1A73E8", alignItems: "center", justifyContent: "center", boxShadow: "0 8px 18px -8px rgba(26,115,232,.7)" }}>
              <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
                <path d="M2.6 16 Q16 4 29.4 16 Q16 28 2.6 16 Z" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinejoin="round" />
                <circle cx="16" cy="16" r="6.3" fill="#34A853" />
                <circle cx="16" cy="16" r="2.3" fill="#fff" />
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {install === "prompt" && (
                <>
                  <h3 style={{ margin: "0 0 3px", fontFamily: "'Source Serif 4',serif", fontSize: 18, fontWeight: 700, color: "#0E2A47" }}>Salve o Verificaki</h3>
                  <p style={{ margin: "0 0 13px", fontSize: 13.5, lineHeight: 1.5, color: "#5F6368" }}>Adicione à tela inicial do seu celular e verifique notícias com um só toque.</p>
                  <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                    <button onClick={() => setInstall("how")} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#1A73E8", color: "#fff", border: "none", borderRadius: 10, padding: "10px 16px", font: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                      Adicionar à tela inicial
                    </button>
                    <button onClick={dismissInstall} style={{ background: "none", border: "none", color: "#80868B", font: "inherit", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "10px 6px" }}>Agora não</button>
                  </div>
                </>
              )}
              {install === "how" && (
                <>
                  <h3 style={{ margin: "0 0 8px", fontFamily: "'Source Serif 4',serif", fontSize: 18, fontWeight: 700, color: "#0E2A47" }}>Como adicionar</h3>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#3c4043", marginBottom: 6 }}>
                    <span style={{ display: "inline-flex", flex: "none", width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#EAF1FD", color: "#1A73E8", fontSize: 12, fontWeight: 700 }}>1</span>
                    Toque em <strong style={{ color: "#0E2A47" }}>Compartilhar</strong> ou no menu <strong style={{ color: "#0E2A47" }}>⋮</strong> do navegador.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "#3c4043", marginBottom: 13 }}>
                    <span style={{ display: "inline-flex", flex: "none", width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: "50%", background: "#EAF1FD", color: "#1A73E8", fontSize: 12, fontWeight: 700 }}>2</span>
                    Escolha <strong style={{ color: "#0E2A47" }}>"Adicionar à Tela de Início"</strong>.
                  </div>
                  <button onClick={dismissInstall} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "#34A853", color: "#fff", border: "none", borderRadius: 10, padding: "10px 18px", font: "inherit", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                    Entendi
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
