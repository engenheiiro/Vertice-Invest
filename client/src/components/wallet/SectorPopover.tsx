import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, PieChart as PieIcon } from 'lucide-react';
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
    /** Eixo da repartição: segmento (FII), macro-setor (ação) ou indexador (RF). */
    kind: SectorKind;
    isPrivacyMode?: boolean;
    /** `touch` amplia o alvo do chip no layout mobile (mínimo confortável de toque). */
    variant?: 'compact' | 'touch';
}

const TRIGGER_SIZE: Record<'compact' | 'touch', string> = {
    compact: 'px-2 py-1',
    touch: 'px-3 min-h-[36px]',
};

/**
 * Cópia por eixo. `chip` é o rótulo do gatilho na linha do grupo e `count` o do
 * miolo do donut: em Renda Fixa a repartição não é por setor, e chamar de
 * "Setores" o que o usuário vê como IPCA/pós/pré ensinaria a palavra errada.
 */
const KIND_COPY: Record<SectorKind, {
    title: string; subtitle: string; chip: string; count: string; trigger: string; accent: string;
}> = {
    FII: {
        title: 'FIIs por setor',
        subtitle: '% do total em FIIs',
        chip: 'Setores',
        count: 'Setores',
        trigger: 'Ver alocação dos FIIs por setor',
        accent: 'text-emerald-400',
    },
    STOCK: {
        title: 'Ações por setor',
        subtitle: '% do total em Ações BR',
        chip: 'Setores',
        count: 'Setores',
        trigger: 'Ver alocação das ações por setor',
        accent: 'text-blue-400',
    },
    FIXED_INCOME: {
        title: 'Renda Fixa por indexador',
        subtitle: '% do total em Renda Fixa',
        chip: 'Indexador',
        count: 'Indexadores',
        trigger: 'Ver a Renda Fixa por indexador (IPCA, pós-fixado, prefixado)',
        // Espelha o acento da classe na lista (CLASS_ACCENT.FIXED_INCOME).
        accent: 'text-amber-400',
    },
};

/** Tickers da fatia no tooltip; a cauda vira "+N" para não estourar a largura. */
const tickerSummary = (tickers: string[], max = 4): string =>
    tickers.length <= max
        ? tickers.join(', ')
        : `${tickers.slice(0, max).join(', ')} +${tickers.length - max}`;

interface SectorTooltipProps {
    active?: boolean;
    payload?: Array<{
        value?: number | string;
        payload?: SectorSlice;
    }>;
    formatValue: (value: number) => string;
    isLight: boolean;
}

/**
 * Tooltip próprio porque o Recharts não propaga de forma confiável o `fill` de
 * cada Cell para o tooltip padrão. A camada explícita também impede que o texto
 * fique atrás do rótulo central do donut.
 */
const SectorTooltip = ({ active, payload, formatValue, isLight }: SectorTooltipProps) => {
    const entry = payload?.[0];
    const slice = entry?.payload;
    if (!active || !slice) return null;

    const value = Number(entry.value ?? slice.value);

    return (
        <div
            className={`min-w-max rounded-lg border px-2.5 py-2 text-[10px] shadow-2xl ${
                isLight
                    ? 'border-slate-200 bg-white text-slate-900'
                    : 'border-slate-600 bg-elevated text-white'
            }`}
        >
            <div className="flex items-center gap-1.5 font-bold">
                <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
                    style={{ backgroundColor: slice.color }}
                />
                <span>{slice.label}</span>
            </div>
            <div className="mt-1 tabular-nums">
                <span className="font-bold" style={{ color: slice.color }}>{slice.pct.toFixed(1)}%</span>
                <span className={isLight ? 'text-slate-600' : 'text-slate-300'}> · {formatValue(value)}</span>
            </div>
            <div className={`mt-0.5 max-w-[180px] truncate ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
                {tickerSummary(slice.tickers)}
            </div>
        </div>
    );
};

/**
 * Chip no cabeçalho de uma classe: hover (desktop) ou toque/clique abre um donut
 * com a repartição atual da classe pelo eixo de risco dela — setor em ação e FII,
 * indexador em Renda Fixa.
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
    // Filtro do donut de Ações BR (ver `etfSplit`). Sobrevive a fechar e reabrir o
    // popover de propósito: quem escondeu o ETF quer LER as ações, e reabrir já
    // filtrado é o que ele pediu. O estado nunca fica invisível — o subtítulo diz
    // sobre que base o percentual está, e o botão do rodapé diz quanto ficou fora.
    const [hideEtf, setHideEtf] = useState(false);

    // Ações BR mistura ações individuais e ETFs de índice, e o ETF ganha balde
    // próprio porque não é setor de coisa nenhuma (BOVA11 não é "Financeiro" por
    // ter bancos dentro). Numa carteira com ETF pesado essa fatia achata todos os
    // setores reais e ainda gasta um dos 6 slots de cor — daí o filtro.
    //
    // Só é oferecido quando os DOIS lados existem: filtrar uma classe só-ETF
    // deixaria o donut vazio, e numa classe sem ETF o botão não teria o que fazer.
    const etfSplit = useMemo(() => {
        if (kind !== 'STOCK') return null;
        let etf = 0;
        let stocks = 0;
        (items || []).forEach((item) => {
            const value = Number(item.totalValue) || 0;
            if (value <= 0) return;
            if (item.type === 'ETF') etf += value; else stocks += value;
        });
        return etf > 0 && stocks > 0 ? { pct: (etf / (etf + stocks)) * 100 } : null;
    }, [items, kind]);

    const isEtfHidden = etfSplit !== null && hideEtf;

    // Filtrar ANTES de agregar (e não esconder a fatia depois) é o ponto: o total
    // é recalculado dentro de computeSectorAllocation, então os percentuais passam
    // a ser sobre as ações individuais. Esconder a fatia e manter o denominador
    // daria um donut que não fecha 100%.
    const slices = useMemo(
        () => computeSectorAllocation(isEtfHidden ? items.filter((i) => i.type !== 'ETF') : items, kind),
        [items, kind, isEtfHidden],
    );
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
                {copy.chip}
            </button>

            {isOpen && position && createPortal(
                <div
                    ref={popoverRef}
                    role="dialog"
                    aria-label={`${copy.title}: ${summary}`}
                    // O popover vai por PORTAL, mas evento de React sobe pela árvore de
                    // COMPONENTES, não pela do DOM: sem isto, qualquer clique aqui dentro
                    // chega no cabeçalho do grupo e contrai a classe. Fica no container
                    // (e não em cada controle) para valer também para o próximo que entrar.
                    onClick={(e) => e.stopPropagation()}
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    style={{ top: position.top, left: position.left, width: POPOVER_WIDTH }}
                    className="fixed z-[100] bg-panel border border-slate-700 rounded-xl shadow-2xl p-3.5 animate-fade-in"
                >
                    <div className="flex items-baseline justify-between mb-2">
                        <h4 className="text-xs font-bold text-white">{copy.title}</h4>
                        <span className="text-[10px] text-slate-500">{isEtfHidden ? '% das ações individuais' : copy.subtitle}</span>
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
                                        content={(
                                            <SectorTooltip
                                                formatValue={formatValue}
                                                isLight={theme === 'light'}
                                            />
                                        )}
                                        allowEscapeViewBox={{ x: true, y: true }}
                                        wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                                <span className="text-[9px] text-slate-500 uppercase font-bold">{copy.count}</span>
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
                    {etfSplit && (
                        <button
                            type="button"
                            aria-pressed={isEtfHidden}
                            onClick={() => setHideEtf((hidden) => !hidden)}
                            title={isEtfHidden
                                ? 'Voltar a contar os ETFs de índice na repartição da classe'
                                : 'Tirar os ETFs de índice da conta e reler os setores só sobre as ações individuais'}
                            className="mt-3 w-full flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white bg-elevated hover:bg-slate-700/50 px-2 py-1.5 rounded-lg border border-slate-800 transition-colors"
                        >
                            {isEtfHidden ? <Eye size={11} /> : <EyeOff size={11} />}
                            {isEtfHidden ? 'Mostrar ETFs' : 'Ocultar ETFs'}
                            {/* O peso do ETF não some junto com a fatia: ele fica no botão. */}
                            <span className="text-slate-500 tabular-nums normal-case">({etfSplit.pct.toFixed(0)}% da classe)</span>
                        </button>
                    )}
                </div>,
                document.body,
            )}
        </>
    );
};
