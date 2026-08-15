import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PieChart as PieIcon } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Asset } from '../../contexts/WalletContext';
import { useTheme } from '../../contexts/ThemeContext';
import { computeSectorAllocation, type SectorKind, type SectorSlice } from '../../utils/sectorAllocation';
import { formatCompact } from '../../utils/format';

const POPOVER_WIDTH = 344;
/** Altura medida com o máximo de fatias — só serve para decidir se abre acima/abaixo. */
const POPOVER_HEIGHT = 210;
const GAP = 8;
/** Folga para o ponteiro atravessar do chip até o popover sem fechar. */
const CLOSE_DELAY_MS = 140;

interface SectorPopoverProps {
    /** Ativos da classe (já filtrados pelo balde de alocação). */
    items: Asset[];
    /** Define a chave de setor: segmento fino (FII) ou macro-setor (ação). */
    kind: SectorKind;
    isPrivacyMode?: boolean;
    /** `touch` amplia o alvo do chip no layout mobile (mínimo confortável de toque). */
    variant?: 'compact' | 'touch';
}

const TRIGGER_SIZE: Record<'compact' | 'touch', string> = {
    compact: 'px-2 py-1',
    touch: 'px-3 min-h-[36px]',
};

const KIND_COPY: Record<SectorKind, { title: string; subtitle: string; trigger: string; accent: string }> = {
    FII: {
        title: 'FIIs por setor',
        subtitle: '% do total em FIIs',
        trigger: 'Ver alocação dos FIIs por setor',
        accent: 'text-emerald-400',
    },
    STOCK: {
        title: 'Ações por setor',
        subtitle: '% do total em Ações BR',
        trigger: 'Ver alocação das ações por setor',
        accent: 'text-blue-400',
    },
};

/** Tickers da fatia no tooltip; a cauda vira "+N" para não estourar a largura. */
const tickerSummary = (tickers: string[], max = 4): string =>
    tickers.length <= max
        ? tickers.join(', ')
        : `${tickers.slice(0, max).join(', ')} +${tickers.length - max}`;

/**
 * Chip "Setores" no cabeçalho de uma classe: hover (desktop) ou toque/clique abre
 * um donut com a repartição atual da classe por setor.
 *
 * O popover vai por PORTAL com posição fixa porque o container da tabela usa
 * `overflow-x-auto` — o que também recorta no eixo Y e engoliria um popover
 * absoluto ancorado na linha do grupo.
 */
export const SectorPopover = ({ items, kind, isPrivacyMode = false, variant = 'compact' }: SectorPopoverProps) => {
    const { theme } = useTheme();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<number | undefined>(undefined);

    const [isOpen, setIsOpen] = useState(false);
    // Clique/toque "prende" o popover: ele deixa de fechar quando o ponteiro sai.
    const [isPinned, setIsPinned] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

    const slices = useMemo(() => computeSectorAllocation(items, kind), [items, kind]);
    const copy = KIND_COPY[kind];

    const cancelClose = useCallback(() => {
        window.clearTimeout(closeTimer.current);
    }, []);

    const close = useCallback(() => {
        cancelClose();
        setIsOpen(false);
        setIsPinned(false);
    }, [cancelClose]);

    const scheduleClose = useCallback(() => {
        cancelClose();
        closeTimer.current = window.setTimeout(() => {
            setIsPinned((pinned) => {
                if (!pinned) setIsOpen(false);
                return pinned;
            });
        }, CLOSE_DELAY_MS);
    }, [cancelClose]);

    const place = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const left = Math.min(
            Math.max(GAP, rect.left + rect.width / 2 - POPOVER_WIDTH / 2),
            window.innerWidth - POPOVER_WIDTH - GAP,
        );
        // Abre para baixo; sem espaço, sobe para cima do chip.
        const below = rect.bottom + GAP;
        const top = below + POPOVER_HEIGHT > window.innerHeight - GAP
            ? Math.max(GAP, rect.top - POPOVER_HEIGHT - GAP)
            : below;
        setPosition({ top, left });
    }, []);

    useLayoutEffect(() => {
        if (isOpen) place();
    }, [isOpen, place]);

    useEffect(() => {
        if (!isOpen) return;
        const onScrollOrResize = () => place();
        const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
            close();
        };
        // capture: pega o scroll de qualquer ancestral (a tabela rola no eixo X).
        window.addEventListener('scroll', onScrollOrResize, true);
        window.addEventListener('resize', onScrollOrResize);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('pointerdown', onPointerDown, true);
        return () => {
            window.removeEventListener('scroll', onScrollOrResize, true);
            window.removeEventListener('resize', onScrollOrResize);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('pointerdown', onPointerDown, true);
        };
    }, [isOpen, place, close]);

    useEffect(() => cancelClose, [cancelClose]);

    if (slices.length === 0) return null;

    const tooltipStyle = theme === 'light'
        ? { backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '8px', fontSize: '11px', color: '#0f172a' }
        : { backgroundColor: '#202631', borderColor: '#334155', borderRadius: '8px', fontSize: '11px' };

    const summary = slices.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join(', ');
    const formatValue = (v: number) => formatCompact(v, 'BRL', { privacy: isPrivacyMode });

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                title={copy.trigger}
                onClick={(e) => {
                    // O cabeçalho do grupo contrai/expande no clique — o chip não pode disparar isso.
                    e.stopPropagation();
                    if (isOpen && isPinned) { close(); return; }
                    setIsOpen(true);
                    setIsPinned(true);
                }}
                onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
                onMouseLeave={scheduleClose}
                onFocus={() => { cancelClose(); setIsOpen(true); }}
                onBlur={scheduleClose}
                className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white bg-elevated hover:bg-slate-700/50 rounded-lg border border-slate-800 transition-colors ${TRIGGER_SIZE[variant]}`}
            >
                <PieIcon size={11} className={copy.accent} />
                Setores
            </button>

            {isOpen && position && createPortal(
                <div
                    ref={popoverRef}
                    role="dialog"
                    aria-label={`${copy.title}: ${summary}`}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
                    className="fixed z-[100] bg-panel border border-slate-700 rounded-xl shadow-2xl p-3.5 animate-fade-in"
                >
                    <div className="flex items-baseline justify-between mb-2">
                        <h4 className="text-xs font-bold text-white">{copy.title}</h4>
                        <span className="text-[10px] text-slate-500">{copy.subtitle}</span>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="w-[112px] h-[112px] shrink-0 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={slices}
                                        dataKey="value"
                                        nameKey="label"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={33}
                                        outerRadius={54}
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
                                <span className="text-[9px] text-slate-500 uppercase font-bold">Setores</span>
                                <span className="text-xs text-white tabular-nums font-bold">{slices.length}</span>
                            </div>
                        </div>

                        {/* Legenda sempre presente e rotulada: a identidade da fatia nunca
                            depende só da cor (o par vizinho mais fraco da paleta fica na
                            faixa 6–8 de separação para daltonismo). */}
                        <ul className="flex-1 min-w-0 space-y-[3px]">
                            {slices.map((slice) => (
                                <li key={slice.key} className="flex items-center justify-between gap-2 text-[11px]">
                                    <span className="flex items-center gap-1.5 min-w-0">
                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: slice.color }} />
                                        <span className="text-slate-400 truncate" title={`${slice.label} — ${slice.tickers.join(', ')}`}>{slice.label}</span>
                                    </span>
                                    <span className="text-right shrink-0">
                                        <span className="block leading-none font-bold text-white tabular-nums">{slice.pct.toFixed(1)}%</span>
                                        <span className="block leading-none text-[9px] text-slate-500 tabular-nums mt-0.5">{formatValue(slice.value)}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};
