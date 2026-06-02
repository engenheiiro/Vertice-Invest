import React, { useMemo } from 'react';

// ── Renderer do texto Explainable IA ─────────────────────────────────────────
// Extraído de Research.tsx (M2) para componente próprio + memoização.
// Converte o markdown-lite gerado pela IA (## seções, bullets 🟢/🟡, **bold**)
// em blocos estilizados conforme o design system.

const SECTION_STYLES: Record<string, { label: string; color: string; border: string; bg: string }> = {
  '📊': { label: '📊', color: 'text-blue-400', border: 'border-blue-900/40', bg: 'bg-blue-900/10' },
  '🟦': { label: '🟦', color: 'text-blue-400', border: 'border-blue-900/40', bg: 'bg-blue-900/10' },
  '📈': { label: '📈', color: 'text-emerald-400', border: 'border-emerald-900/40', bg: 'bg-emerald-900/10' },
  '🏆': { label: '🏆', color: 'text-emerald-400', border: 'border-emerald-900/40', bg: 'bg-emerald-900/10' },
  '🔄': { label: '🔄', color: 'text-purple-400', border: 'border-purple-900/40', bg: 'bg-purple-900/10' },
  '⚠️': { label: '⚠️', color: 'text-yellow-400', border: 'border-yellow-900/40', bg: 'bg-yellow-900/10' },
  '💡': { label: '💡', color: 'text-indigo-400', border: 'border-indigo-900/40', bg: 'bg-indigo-900/10' },
};

const getSectionStyle = (heading: string) => {
  for (const emoji of Object.keys(SECTION_STYLES)) {
    if (heading.includes(emoji)) return SECTION_STYLES[emoji];
  }
  return { color: 'text-slate-300', border: 'border-slate-700', bg: 'bg-slate-800/30' };
};

const parseBoldInline = (text: string): React.ReactNode[] => {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="text-white font-bold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
};

const renderLine = (line: string, i: number): React.ReactNode => {
  const t = line.trim();
  if (!t) return <div key={i} className="h-2" />;

  // Cabeçalho de seção: aceita qualquer nível de markdown (##, ###, …).
  // Ex.: "### 🟦 Cenário Macro" — antes só "## " era reconhecido e os demais
  // vazavam como texto literal com os '#' à mostra.
  if (/^#{1,6}\s/.test(t)) {
    const heading = t.replace(/^#{1,6}\s+/, '');
    const style = getSectionStyle(heading);
    return (
      <div
        key={i}
        className={`flex items-center gap-2 mt-7 mb-3 px-3 py-2 rounded-xl border ${style.border} ${style.bg}`}
      >
        <span className={`text-sm font-black tracking-tight ${style.color}`}>{heading}</span>
      </div>
    );
  }

  // Bullet COMPRAR: - 🟢 **TICKER** — …
  if (/^[-•]\s*🟢/.test(t)) {
    const content = t.replace(/^[-•]\s*🟢\s*/, '');
    return (
      <div key={i} className="flex gap-2 items-start mb-2 ml-2">
        <span className="text-[9px] font-black text-emerald-400 bg-emerald-900/20 border border-emerald-900/40 px-1.5 py-0.5 rounded mt-[3px] shrink-0 whitespace-nowrap">
          COMPRAR
        </span>
        <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
      </div>
    );
  }

  // Bullet AGUARDAR: - 🟡 **TICKER** — …
  if (/^[-•]\s*🟡/.test(t)) {
    const content = t.replace(/^[-•]\s*🟡\s*/, '');
    return (
      <div key={i} className="flex gap-2 items-start mb-2 ml-2">
        <span className="text-[9px] font-black text-yellow-400 bg-yellow-900/20 border border-yellow-900/40 px-1.5 py-0.5 rounded mt-[3px] shrink-0 whitespace-nowrap">
          AGUARDAR
        </span>
        <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
      </div>
    );
  }

  // Bullet genérico: - texto
  if (/^[-•]\s/.test(t)) {
    const content = t.replace(/^[-•]\s/, '');
    return (
      <div key={i} className="flex gap-3 items-start mb-2 ml-2">
        <div className="w-1.5 h-1.5 rounded-full bg-slate-500 mt-[7px] shrink-0" />
        <p className="text-slate-300 text-sm leading-relaxed">{parseBoldInline(content)}</p>
      </div>
    );
  }

  // Parágrafo normal
  return (
    <p key={i} className="text-slate-400 text-sm leading-relaxed mb-2 px-1">
      {parseBoldInline(t)}
    </p>
  );
};

const ExplainableAIRendererBase: React.FC<{ text: string }> = ({ text }) => {
  // Parsing memoizado: só recomputa quando o texto muda.
  const rendered = useMemo(() => text.split('\n').map(renderLine), [text]);
  return <div className="space-y-1">{rendered}</div>;
};

export const ExplainableAIRenderer = React.memo(ExplainableAIRendererBase);
