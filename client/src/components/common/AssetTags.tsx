import type { AssetTag, AssetTagTone } from '../../utils/assetDisplay';

/** Paleta dos selos — espelha os acentos de classe (ETF teal, imobiliário emerald...). */
const TONE_CLASS: Record<AssetTagTone, string> = {
  etf: 'text-teal-400 bg-teal-500/10 border-teal-500/30',
  reit: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  gold: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  dollar: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  warning: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  // Estado informativo, não um alerta: "na curva" é o padrão de boa parte da RF.
  neutral: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
};

const SIZE_CLASS = {
  sm: 'text-[8px] px-1 py-0.5',
  md: 'text-[9px] px-1.5 py-0.5',
} as const;

interface AssetTagsProps {
  tags: AssetTag[];
  /** `sm` em cards mobile, `md` (default) nas tabelas. */
  size?: keyof typeof SIZE_CLASS;
}

/**
 * Selos do ativo ao lado do ticker (ETF, REIT, Ouro, Dólar, Vencido). Fonte única
 * de layout/cor — call sites só passam `getAssetTags(asset)`, garantindo a mesma
 * leitura na Carteira e no Dashboard, em qualquer classe.
 */
export default function AssetTags({ tags, size = 'md' }: AssetTagsProps) {
  if (!tags.length) return null;

  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag.label}
          title={tag.title}
          className={`shrink-0 font-bold uppercase tracking-wide leading-none border rounded ${SIZE_CLASS[size]} ${TONE_CLASS[tag.tone]}`}
        >
          {tag.label}
        </span>
      ))}
    </>
  );
}
