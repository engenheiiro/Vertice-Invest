import React from 'react';
import { Wallet, Crown, Medal, History, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { RankingItem } from '../../services/research';
import type { AssetType } from '../../contexts/WalletContext';
import AssetLogo from '../common/AssetLogo';
import { onActivateKey } from '../../utils/a11yEvents';
import { getPositionDelta, rankStyle, scoreTextColor, yieldColor, type PickPosition, type RankedPick } from './topPicksView';

type Money = (val: number) => string;

const PositionDeltaBadge: React.FC<{ position?: number; previousPosition?: number | null }> = ({ position, previousPosition }) => {
    const delta = getPositionDelta(position, previousPosition);
    if (!delta) return null;
    if (delta.kind === 'new') {
        return (
            <span title="Entrou no ranking nesta revisão" className="text-[7px] font-black uppercase tracking-wider text-blue-400 bg-blue-900/10 px-1 py-px rounded border border-blue-900/30 leading-none">
                novo
            </span>
        );
    }
    if (delta.kind === 'same') {
        return (
            <span title={`Manteve a posição ${previousPosition}`} aria-label="Posição mantida" className="flex items-center text-slate-500 leading-none">
                <Minus size={10} />
            </span>
        );
    }
    const isUp = delta.kind === 'up';
    const Icon = isUp ? ArrowUp : ArrowDown;
    return (
        <span
            title={`${isUp ? 'Subiu' : 'Caiu'} ${delta.steps} ${delta.steps === 1 ? 'posição' : 'posições'} (era ${previousPosition}º)`}
            aria-label={`${isUp ? 'Subiu' : 'Caiu'} ${delta.steps}`}
            className={`flex items-center gap-px text-[8px] font-black tabular-nums leading-none ${isUp ? 'text-emerald-400' : 'text-red-400'}`}
        >
            <Icon size={9} strokeWidth={3} />{delta.steps}
        </span>
    );
};

// Tier vindo do backend (rodada do draft competitivo); sem tier, nada.
const TierBadge = ({ tier }: { tier?: string }) => {
    if (tier === 'GOLD') return <span title="Top Tier (Rodada 1)" className="text-gold"><Medal size={12} fill="currentColor" /></span>;
    if (tier === 'SILVER') return <span title="Mid Tier (Rodada 2)" className="text-slate-300"><Medal size={12} fill="currentColor" /></span>;
    if (tier === 'BRONZE') return <span title="Backfill (Rodada 3)" className="text-amber-700"><Medal size={12} fill="currentColor" /></span>;
    return null;
};

const WAIT_PILL = 'text-[10px] font-black text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded border border-slate-700';
const GOOD_PILL = 'text-[10px] font-black text-emerald-400 bg-emerald-900/10 px-1.5 py-0.5 rounded border border-emerald-900/20';
const OVER_PILL = 'text-[10px] font-black text-yellow-500 bg-yellow-900/10 px-1.5 py-0.5 rounded border border-yellow-900/20';

const RowIdentity = ({ pick }: { pick: RankedPick }) => (
    <div className="lg:col-span-4 flex items-center gap-3">
        <div className="flex flex-col items-center gap-1 shrink-0">
            <div className={`w-8 h-8 flex flex-col items-center justify-center rounded-lg border shrink-0 ${rankStyle(pick.visualPosition)}`}>
                <span className="font-black text-sm leading-none">{pick.visualPosition}</span>
            </div>
            <PositionDeltaBadge position={pick.position} previousPosition={pick.previousPosition} />
        </div>
        <AssetLogo ticker={pick.ticker} type={pick.type as AssetType} name={pick.name} sector={pick.sector} size={36} />
        <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1 mb-1">
                <h4 className="text-base font-black text-white tracking-tight">{pick.ticker}</h4>
                <div className="flex items-center gap-1 shrink-0">
                    {(pick as any).isDividendAristocrat && (
                        <span title="Dividend Aristocrat: Crescimento Consistente" className="text-emerald-400">
                            <Crown size={12} fill="currentColor" />
                        </span>
                    )}
                    <TierBadge tier={(pick as any).tier} />
                </div>
            </div>
            <div className="flex items-center gap-2 min-w-0">
                {/* Único badge de setor/segmento, em linha única (sem quebra). O sub-tipo
                    Stocks/REITs/ETFs deixou de ser badge: o ranking já é puro por classe. */}
                <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-bold uppercase border border-slate-700 whitespace-nowrap truncate max-w-full" title={pick.sector || 'Geral'}>{pick.sector || 'Geral'}</span>
            </div>
        </div>
    </div>
);

/** Terceira coluna de preços: market cap na Cripto, yield colorido no resto. */
const YieldOrCap = ({ pick, isCrypto }: { pick: RankedPick; isCrypto: boolean }) => (
    <div className="text-center sm:text-left">
        <p className="text-[8px] font-bold text-slate-500 uppercase">{isCrypto ? 'Market Cap' : 'Yield'}</p>
        {isCrypto ? (
            <p className="text-xs font-bold tabular-nums text-slate-300">
                {pick.metrics.marketCap ? `$${(pick.metrics.marketCap / 1e9).toFixed(1)}B` : '-'}
            </p>
        ) : (
            <p className={`text-xs font-bold tabular-nums ${yieldColor(pick.metrics.dy)}`}>
                {pick.metrics.dy ? pick.metrics.dy.toFixed(1) : 0}%
            </p>
        )}
    </div>
);

const SCORE_BARS = [
    { label: 'Qualidade', key: 'quality', bar: 'bg-blue-500' },
    { label: 'Valuation', key: 'valuation', bar: 'bg-emerald-500' },
    { label: 'Segurança', key: 'risk', bar: 'bg-purple-500' },
] as const;

/** Preço → Teto → Yield, divisor e as três barras estruturais (50 quando ausente). */
const RowNumbers = ({ pick, isCrypto, formatCurrency }: { pick: RankedPick; isCrypto: boolean; formatCurrency: Money }) => (
    <div className="lg:col-span-8 flex flex-col sm:flex-row items-center gap-6 w-full">
        <div className="flex gap-6 shrink-0">
            <div className="text-center sm:text-left">
                <p className="text-[8px] font-bold text-slate-500 uppercase">Preço Atual</p>
                <p className="text-xs font-bold text-slate-300 tabular-nums">{formatCurrency(pick.currentPrice)}</p>
            </div>
            <div className="text-center sm:text-left">
                <p className="text-[8px] font-bold text-slate-500 uppercase">Preço Teto</p>
                <p className="text-xs font-bold text-blue-400 tabular-nums">{formatCurrency(pick.targetPrice || 0)}</p>
            </div>
            <YieldOrCap pick={pick} isCrypto={isCrypto} />
        </div>

        {/* Divisor Vertical (Desktop) */}
        <div className="hidden sm:block w-px h-8 bg-slate-800"></div>

        <div className="flex-1 grid grid-cols-3 gap-3 w-full">
            {SCORE_BARS.map(({ label, key, bar }) => {
                const value = pick.metrics?.structural?.[key] ?? 50;
                return (
                    <div key={key}>
                        <p className="text-[7px] font-bold text-slate-500 uppercase mb-1 flex justify-between">
                            <span>{label}</span> <span>{value}</span>
                        </p>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${value}%` }}></div></div>
                    </div>
                );
            })}
        </div>
    </div>
);

/**
 * Rebalanceamento só faz sentido para COMPRAR (meta > 0). Num AGUARDAR possuído
 * o modelo não pede aumento nem corte: mostra status neutro em vez de "Excede",
 * que soaria como ordem de venda.
 */
const RebalanceStatus = ({ position, formatCurrency }: { position: PickPosition; formatCurrency: Money }) => {
    if (!position.isBuyPick) return <span className={WAIT_PILL}>Aguardar</span>;
    const gap = formatCurrency(Math.abs(position.rebalanceDelta));
    return position.rebalanceDelta > 0
        ? <span className={OVER_PILL}>Excede {gap}</span>
        : <span className={GOOD_PILL}>Falta {gap}</span>;
};

const HeldPosition = ({ position, heldValue, formatCurrency }: { position: PickPosition; heldValue: number; formatCurrency: Money }) => {
    const { userAllocPercent, idealPercent } = position;
    return (
        <div>
            <div className="flex justify-between items-end mb-1">
                <span className="text-xs font-bold text-white tabular-nums">{formatCurrency(heldValue)}</span>
                <span className={`text-[9px] font-bold ${userAllocPercent > idealPercent ? 'text-yellow-500' : 'text-blue-400'}`}>
                    {userAllocPercent.toFixed(1)}%
                </span>
            </div>
            <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden relative">
                <div className="h-full bg-blue-500 absolute left-0" style={{ width: `${Math.min(userAllocPercent * 5, 100)}%` }}></div>
                <div className="h-full w-0.5 bg-slate-400 absolute z-10" style={{ left: `${Math.min(idealPercent * 5, 100)}%` }}></div>
            </div>
            <div className="mt-2 text-right"><RebalanceStatus position={position} formatCurrency={formatCurrency} /></div>
        </div>
    );
};

/** Sem posição: só sugere aporte em COMPRAR; em AGUARDAR o sistema não recomenda entrada. */
const NoPosition = ({ position, formatCurrency }: { position: PickPosition; formatCurrency: Money }) => (
    <div className="flex flex-col gap-1">
        <div className="w-full h-5 rounded bg-slate-800/50 border border-dashed border-slate-700 flex items-center justify-center">
            <span className="text-[8px] text-slate-600 font-bold uppercase">Não possui</span>
        </div>
        <div className="text-right mt-1">
            {position.isBuyPick
                ? <span className={GOOD_PILL}>Aportar ~{formatCurrency(position.idealValue)}</span>
                : <span className={WAIT_PILL}>Aguardar</span>}
        </div>
    </div>
);

/**
 * Selo "Já estava". Um AGUARDAR no MEIO do ranking é o que mais confunde: o
 * ativo aparece acima de outros e sem sinal de compra, porque a lista mantém
 * quem já estava enquanto o score não cai abaixo do mínimo. O selo NÃO fala de
 * ação: COMPRAR/AGUARDAR continua vindo só do score.
 */
const RetentionSeal = ({ retention }: { retention: RankingItem['retention'] }) => {
    if (!retention?.retained) return null;
    const title = retention.reason
        + (retention.previousPosition ? ` · era ${retention.previousScore} na posição ${retention.previousPosition}` : '');
    return (
        <span
            title={title}
            className="flex items-center gap-1 text-[8px] font-black text-blue-400 bg-blue-900/10 px-1.5 py-0.5 rounded border border-blue-900/30 uppercase tracking-wider whitespace-nowrap"
        >
            <History size={8} /> Já estava
        </span>
    );
};

const RowAction = ({ pick }: { pick: RankedPick }) => {
    const isBuy = pick.action === 'BUY';
    const actionClass = isBuy ? 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' : 'text-slate-400 bg-slate-800 border-slate-700';
    return (
        <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0 min-w-[140px]">
            <div className="text-center">
                <div className="text-[8px] font-black uppercase text-slate-500 mb-1">Score</div>
                <span className={`text-lg font-black ${scoreTextColor(pick.score)}`}>{pick.score}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
                <div className={`px-3 py-1.5 rounded-lg border flex flex-col items-center min-w-[80px] ${actionClass}`}>
                    <span className="text-[9px] font-black tracking-tighter">{isBuy ? 'COMPRAR' : 'AGUARDAR'}</span>
                </div>
                <RetentionSeal retention={pick.retention} />
            </div>
        </div>
    );
};

const UserPosition = ({ position, formatCurrency }: { position: PickPosition; formatCurrency: Money }) => (
    <div className="flex-1 sm:w-40 flex flex-col justify-center">
        <div className="flex justify-between items-center mb-1">
            <p className="text-[8px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <Wallet size={8} /> Sua Posição
            </p>
            <span className="text-[8px] font-bold text-slate-600">Meta: {position.isBuyPick ? `${position.idealPercent.toFixed(0)}%` : '—'}</span>
        </div>
        {position.held
            ? <HeldPosition position={position} heldValue={position.held.totalValue} formatCurrency={formatCurrency} />
            : <NoPosition position={position} formatCurrency={formatCurrency} />}
    </div>
);

interface TopPickRowProps {
    pick: RankedPick;
    assetClass: string;
    position: PickPosition;
    formatCurrency: Money;
    onSelect: (pick: RankingItem) => void;
}

/** Uma linha da "Composição Detalhada": identidade, preços, scores, posição do usuário e ação. */
export const TopPickRow = ({ pick, assetClass, position, formatCurrency, onSelect }: TopPickRowProps) => (
    <div role="button" tabIndex={0} aria-label={`Ver detalhes de ${pick.ticker}`} onClick={() => onSelect(pick)} onKeyDown={onActivateKey(() => onSelect(pick))} className="bg-base border border-slate-800 rounded-2xl p-4 hover:border-slate-600 hover:bg-panel transition-all cursor-pointer group relative overflow-hidden">
        <div className="flex flex-col xl:flex-row gap-6 items-center">
            <div className="flex-1 w-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6 items-center">
                <RowIdentity pick={pick} />
                <RowNumbers pick={pick} isCrypto={assetClass === 'CRYPTO'} formatCurrency={formatCurrency} />
            </div>
            <div className="flex flex-col sm:flex-row gap-6 w-full xl:w-auto xl:border-l xl:border-slate-800 xl:pl-6">
                <UserPosition position={position} formatCurrency={formatCurrency} />
                <RowAction pick={pick} />
            </div>
        </div>
    </div>
);
