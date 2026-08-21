import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { PieChart as PieIcon, Layers } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { formatCompact, formatCurrency } from '../../utils/format';
import type { SectorSlice } from '../../utils/sectorAllocation';
import type { AporteSectorView } from '../../utils/aporteSectorAllocation';

interface AporteSectorBreakdownProps {
    view: AporteSectorView;
    currency: 'BRL' | 'USD';
    /** Só mascara os valores da CARTEIRA — o aporte é um número que o usuário digitou. */
    isPrivacyMode?: boolean;
}

/** Tickers da fatia no tooltip; a cauda vira "+N" para não estourar a largura. */
const tickerSummary = (tickers: string[], max = 4): string =>
    tickers.length <= max ? tickers.join(', ') : `${tickers.slice(0, max).join(', ')} +${tickers.length - max}`;

interface DonutProps {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    slices: SectorSlice[];
    centerLabel: string;
    formatValue: (v: number) => string;
    /** Legenda de comparação: % da mesma fatia antes do aporte. */
    beforePctByKey?: Map<string, number>;
}

const SectorDonut: React.FC<DonutProps> = ({ title, subtitle, icon, slices, centerLabel, formatValue, beforePctByKey }) => {
    const { theme } = useTheme();

    const tooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '11px', color: '#0f172a' }
        : { backgroundColor: '#202631', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' };

    return (
        <div className="rounded-xl bg-card border border-slate-800 p-3">
            <div className="flex items-baseline justify-between mb-2 gap-2">
                <h5 className="text-[11px] font-bold text-white flex items-center gap-1.5 min-w-0">
                    {icon}
                    <span className="truncate">{title}</span>
                </h5>
                <span className="text-[9px] text-slate-500 shrink-0">{subtitle}</span>
            </div>

            <div className="flex items-center gap-3">
                {/* O donut é decorativo: a legenda abaixo carrega rótulo, % e valor —
                    a identidade da fatia nunca depende só da cor. */}
                <div className="w-[104px] h-[104px] shrink-0 relative" aria-hidden="true">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={slices}
                                dataKey="value"
                                nameKey="label"
                                cx="50%"
                                cy="50%"
                                innerRadius={30}
                                outerRadius={50}
                                paddingAngle={2}
                                stroke="none"
                                isAnimationActive={false}
                            >
                                {slices.map((slice) => (
                                    <Cell key={slice.key} fill={slice.color} />
                                ))}
                            </Pie>
                            <Tooltip
                                contentStyle={tooltipStyle}
                                formatter={(value: number, _name, entry: { payload?: SectorSlice }) => {
                                    const slice = entry?.payload;
                                    const tickers = slice ? ` · ${tickerSummary(slice.tickers)}` : '';
                                    return [`${(slice?.pct ?? 0).toFixed(1)}% · ${formatValue(value)}${tickers}`, ''];
                                }}
                            />
                        </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <span className="text-[8px] text-slate-500 uppercase font-bold">Setores</span>
                        <span className="text-xs text-white tabular-nums font-bold">{centerLabel}</span>
                    </div>
                </div>

                <ul className="flex-1 min-w-0 space-y-[3px]">
                    {slices.map((slice) => {
                        const before = beforePctByKey?.get(slice.key);
                        const delta = before == null ? null : slice.pct - before;
                        // ±0,1 pp é ruído de arredondamento — não vale pintar de verde/vermelho.
                        const deltaColor = delta == null || Math.abs(delta) < 0.1
                            ? 'text-slate-600'
                            : delta > 0 ? 'text-emerald-500' : 'text-slate-500';
                        return (
                            <li key={slice.key} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                                    <span className="text-slate-400 truncate" title={`${slice.label} — ${slice.tickers.join(', ')}`}>
                                        {slice.label}
                                    </span>
                                </span>
                                <span className="text-right shrink-0">
                                    <span className="block leading-none font-bold text-white tabular-nums">{slice.pct.toFixed(1)}%</span>
                                    {delta == null ? (
                                        <span className="block leading-none text-[9px] text-slate-500 tabular-nums mt-0.5">
                                            {formatValue(slice.value)}
                                        </span>
                                    ) : (
                                        <span className={`block leading-none text-[9px] tabular-nums mt-0.5 ${deltaColor}`}>
                                            antes {before!.toFixed(1)}% ({delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(1)} pp)
                                        </span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
};

/**
 * Bloco setorial do Aporte Inteligente: como o aporte se reparte entre setores e
 * como a carteira do usuário fica DEPOIS de comprá-lo.
 *
 * A segunda leitura só aparece quando já existe posição na classe — sem posição
 * anterior ela seria uma cópia da primeira, e duas pizzas idênticas passam a
 * impressão de que dizem coisas diferentes.
 */
export const AporteSectorBreakdown: React.FC<AporteSectorBreakdownProps> = ({ view, currency, isPrivacyMode = false }) => {
    const { aporte, after, beforePctByKey, currentTotal, aporteSectorCount, afterSectorCount } = view;
    if (aporte.length === 0) return null;

    const hasPosition = currentTotal > 0 && after.length > 0;

    return (
        <div className="mt-4 pt-3 border-t border-slate-800/60 space-y-2.5">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Alocação setorial</h4>

            <SectorDonut
                title="Do aporte"
                subtitle={`${aporteSectorCount} ${aporteSectorCount === 1 ? 'setor' : 'setores'}`}
                icon={<PieIcon size={11} className="text-emerald-400" />}
                slices={aporte}
                centerLabel={String(aporteSectorCount)}
                formatValue={(v) => formatCurrency(v, currency)}
            />

            {hasPosition ? (
                <SectorDonut
                    title="Sua carteira depois"
                    subtitle="posição atual + aporte"
                    icon={<Layers size={11} className="text-blue-400" />}
                    slices={after}
                    centerLabel={String(afterSectorCount)}
                    formatValue={(v) => formatCompact(v, 'BRL', { privacy: isPrivacyMode })}
                    beforePctByKey={beforePctByKey}
                />
            ) : (
                <p className="text-[10px] text-slate-500 leading-relaxed px-1">
                    Você ainda não tem essa classe na carteira — depois do aporte a alocação dela
                    fica igual à repartição acima.
                </p>
            )}
        </div>
    );
};
