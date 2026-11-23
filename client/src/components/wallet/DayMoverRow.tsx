import React from 'react';
import AssetLogo from '../common/AssetLogo';
import { formatPercent } from '../../utils/format';
import { reasonDescription, type DayMoverRow } from '../../utils/dayMovers';
import { moverRowView } from '../../utils/dayMoversView';

/** Grade compartilhada pelo cabeçalho de colunas e pelas linhas. */
export const GRID = 'grid grid-cols-[minmax(0,1fr)_92px_52px] gap-2 sm:grid-cols-[minmax(0,1fr)_190px_78px] sm:gap-4';

/**
 * Barra de composição do dia: quantas posições subiram, caíram e ficaram
 * paradas. Troca a contagem em texto solto por uma proporção que se enxerga
 * antes de ler.
 */
export const CompositionBar: React.FC<{ up: number; down: number; flat: number }> = ({ up, down, flat }) => (
    <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {up > 0 && <div className="rounded-full bg-emerald-500" style={{ flex: up }} />}
        {down > 0 && <div className="rounded-full bg-red-500" style={{ flex: down }} />}
        {flat > 0 && <div className="rounded-full bg-slate-600" style={{ flex: flat }} />}
    </div>
);

interface MoverRowProps {
    row: DayMoverRow;
    scale: number;
    hideReason: boolean;
    money: (v: number) => string;
    signedMoney: (v: number) => string;
}

type RowView = ReturnType<typeof moverRowView>;

/**
 * Etiquetas da linha. Sem caixa nem borda: as etiquetas QUALIFICAM o número,
 * não competem com ele. Preenchidas em âmbar, eram o elemento mais forte de uma
 * tela cujo assunto é a coluna de reais.
 */
const MoverTags: React.FC<{ row: DayMoverRow; view: RowView; money: (v: number) => string }> = ({ row, view, money }) => {
    if (!view.label && !(row.dividends > 0)) return null;
    return (
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-[9.5px] font-semibold uppercase tracking-wide">
            {view.label && (
                <span
                    title={reasonDescription(row.reason) ?? undefined}
                    className={`truncate ${view.tone === 'warning' ? 'text-yellow-500/80' : 'text-slate-500'}`}
                >
                    {view.label}
                </span>
            )}
            {row.dividends > 0 && (
                <span
                    title={`Ficou ex-provento: ${money(row.dividends)} creditados como proventos.`}
                    className="shrink-0 text-gold/90"
                >
                    ex-provento
                </span>
            )}
        </div>
    );
};

/**
 * Barra proporcional: torna visível quem EXPLICA o dia. Sem ela, duas posições
 * que respondem por 60% do resultado ficam indistinguíveis das oito que
 * respondem pelo resto.
 */
const MoverBar: React.FC<{ view: RowView }> = ({ view }) => (
    <div
        className={`hidden h-[5px] flex-1 rounded-full bg-slate-800 sm:flex ${view.isUp ? 'justify-start' : 'justify-end'}`}
        aria-hidden="true"
    >
        {!view.isFlat && (
            <div
                className={`h-[5px] rounded-full ${view.isUp ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                style={{ width: `${view.width}%` }}
            />
        )}
    </div>
);

export const MoverRow: React.FC<MoverRowProps> = ({ row, scale, hideReason, money, signedMoney }) => {
    const view = moverRowView(row, scale, hideReason);

    return (
        <div className={`${GRID} items-center border-b border-slate-800/50 py-2.5 last:border-b-0`}>
            <div className="flex min-w-0 items-center gap-2.5">
                <AssetLogo
                    ticker={row.ticker}
                    type={row.type}
                    currency={row.currency}
                    name={row.name}
                    sector={row.sector}
                    isReserve={row.isReserve}
                    size={28}
                    rounded="lg"
                    className="shrink-0"
                />
                {/* Etiqueta em LINHA PRÓPRIA. Ao lado do ticker ela disputava a
                    mesma largura e, no celular, vencia: "IVVB11 · ETF" sumia inteiro
                    e sobrava só o aviso — a linha perdia o nome do ativo. */}
                <div className="min-w-0">
                    <span
                        title={view.assetLabel}
                        className="block truncate text-[13px] font-bold text-slate-100"
                    >
                        {view.isReserve ? row.name : row.ticker}
                        {!view.isReserve && (
                            <span className="font-medium text-slate-500"> · {view.assetClass}</span>
                        )}
                    </span>
                    <MoverTags row={row} view={view} money={money} />
                </div>
            </div>

            <div className="flex items-center justify-end gap-2.5">
                <MoverBar view={view} />
                <span className={`w-[76px] shrink-0 text-right font-mono text-[13px] font-bold tabular-nums ${view.valueClass}`}>
                    {signedMoney(row.value)}
                </span>
            </div>

            <div className="text-right font-mono text-[11.5px] tabular-nums text-slate-500">
                {formatPercent(row.percent, { sign: true })}
            </div>
        </div>
    );
};
