import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Copy, HelpCircle } from 'lucide-react';
import type { AssetType } from '../../../contexts/WalletContext';
import type { ImportPreview, ResolvedRow } from './types';

/**
 * Conferência do que será importado.
 *
 * A tela é organizada por ATIVO, não por lançamento, porque é assim que o
 * usuário confere: ele olha o Investidor10 e pergunta "tenho 200 MXRF11 a
 * R$ 10,45 — bate?". Uma lista de 300 lançamentos não responde essa pergunta, e
 * ainda seria pesada de renderizar.
 *
 * A classe também é decidida por ativo, não por linha: no nosso modelo a posição
 * tem um tipo só (`UserAsset.type`), então oferecer a escolha por lançamento
 * criaria uma decisão que o sistema não sabe honrar.
 *
 * Os lançamentos individuais só aparecem no bloco de problemas — que é onde o
 * detalhe importa.
 */

/** Decisão do usuário sobre um ativo do lote. */
export interface TickerDecision {
    include: boolean;
    type: AssetType | null;
}

interface Props {
    preview: ImportPreview;
    decisions: Record<string, TickerDecision>;
    onChange: (ticker: string, decision: TickerDecision) => void;
    currencyOf: (currency: string) => Intl.NumberFormat;
}

const TYPE_LABELS: Array<{ value: AssetType; label: string }> = [
    { value: 'STOCK', label: 'Ação' },
    { value: 'FII', label: 'FII' },
    { value: 'ETF', label: 'ETF' },
    { value: 'STOCK_US', label: 'Exterior' },
    { value: 'CRYPTO', label: 'Cripto' },
    { value: 'FIXED_INCOME', label: 'Renda Fixa' },
];

const quantityFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
/**
 * `2026-07-31` → `31/07/2026`.
 *
 * O `slice` não é decoração: a data volta do preview já resolvida pelo servidor,
 * onde virou `Date` e foi serializada como `2026-07-31T12:00:00.000Z`. Sem
 * cortar a hora, o split pelo hífen entregava "31T12:00:00.000Z/07/2026" na tela.
 */
const dateFormat = (iso: string) => {
    const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
    return d ? `${d}/${m}/${y}` : iso;
};

/** Linhas que exigem decisão ou merecem um segundo olhar antes de gravar. */
const isProblem = (row: ResolvedRow) => row.status !== 'ok';

export const ImportReviewTable: React.FC<Props> = ({ preview, decisions, onChange, currencyOf }) => {
    const problems = useMemo(() => preview.rows.filter(isProblem), [preview.rows]);

    // Duplicatas ficam agrupadas: listar 40 linhas repetidas uma a uma só
    // atrapalha quem está conferindo. Elas nunca são importadas.
    const duplicates = problems.filter((r) => r.status === 'duplicado');
    const actionable = problems.filter((r) => r.status !== 'duplicado');

    return (
        <div className="space-y-5">
            {/* --- Resumo por ativo: a conferência de verdade --- */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Posição resultante ({preview.summary.length} ativo{preview.summary.length === 1 ? '' : 's'})
                    </h3>
                    <p className="text-[11px] text-slate-500">Compare com a sua carteira de origem</p>
                </div>

                <div className="border border-slate-800 rounded-xl overflow-hidden">
                    <div className="max-h-[42vh] overflow-y-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-card sticky top-0 z-10">
                                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                                    <th className="text-left font-bold px-3 py-2.5 w-10">
                                        <span className="sr-only">Incluir</span>
                                    </th>
                                    <th className="text-left font-bold px-3 py-2.5">Ativo</th>
                                    <th className="text-left font-bold px-3 py-2.5">Classe</th>
                                    <th className="text-right font-bold px-3 py-2.5">Quantidade</th>
                                    <th className="text-right font-bold px-3 py-2.5">Preço médio</th>
                                    <th className="text-right font-bold px-3 py-2.5">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                                {preview.summary.map((item) => {
                                    const decision = decisions[item.ticker] ?? { include: true, type: item.type };
                                    const money = currencyOf(item.currency);
                                    const semClasse = !decision.type;

                                    return (
                                        <tr
                                            key={item.ticker}
                                            className={`transition-colors ${decision.include ? 'hover:bg-panel/60' : 'opacity-40'}`}
                                        >
                                            <td className="px-3 py-2.5">
                                                <input
                                                    type="checkbox"
                                                    checked={decision.include}
                                                    onChange={(e) => onChange(item.ticker, { ...decision, include: e.target.checked })}
                                                    aria-label={`Incluir ${item.ticker} na importação`}
                                                    className="w-4 h-4 rounded border-slate-600 bg-panel text-emerald-500 focus:ring-emerald-500/40 cursor-pointer"
                                                />
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <div className="font-bold text-slate-100">{item.ticker}</div>
                                                {item.name && (
                                                    <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{item.name}</div>
                                                )}
                                                {item.hadPosition && (
                                                    <div className="text-[11px] text-yellow-500 mt-0.5">
                                                        Já existe na carteira — os lançamentos serão somados
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2.5">
                                                <select
                                                    value={decision.type ?? ''}
                                                    onChange={(e) => onChange(item.ticker, { ...decision, type: (e.target.value || null) as AssetType | null })}
                                                    aria-label={`Classe de ${item.ticker}`}
                                                    className={`bg-panel border rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none focus:ring-1 ${
                                                        semClasse
                                                            ? 'border-red-500/60 focus:ring-red-500/40'
                                                            : 'border-slate-700 focus:ring-emerald-500/40'
                                                    }`}
                                                >
                                                    <option value="">Escolha…</option>
                                                    {TYPE_LABELS.map((t) => (
                                                        <option key={t.value} value={t.value}>{t.label}</option>
                                                    ))}
                                                </select>
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">
                                                {quantityFormat.format(item.quantity)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-200">
                                                {money.format(item.averagePrice)}
                                            </td>
                                            <td className="px-3 py-2.5 text-right tabular-nums font-bold text-slate-100">
                                                {money.format(item.totalCost)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* --- Duplicatas: informativas, nunca importadas --- */}
            {duplicates.length > 0 && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-panel border border-slate-800">
                    <Copy size={15} className="text-slate-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-slate-400">
                        <strong className="text-slate-200">{duplicates.length} lançamento(s) já existiam</strong> nesta
                        carteira (ou vieram repetidos no arquivo) e foram descartados automaticamente. Você pode importar
                        o mesmo extrato duas vezes sem duplicar nada.
                    </p>
                </div>
            )}

            {/* --- Problemas que pedem atenção --- */}
            {actionable.length > 0 && (
                <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-yellow-500" />
                        {actionable.length} lançamento(s) pedem atenção
                    </h3>
                    <div className="border border-yellow-900/40 rounded-xl overflow-hidden">
                        <div className="max-h-[24vh] overflow-y-auto divide-y divide-slate-800/70">
                            {actionable.slice(0, 100).map((row, i) => (
                                <div key={`${row.ticker}-${row.date}-${i}`} className="flex items-start gap-3 px-3 py-2.5 bg-panel/40">
                                    {row.status === 'nao_reconhecido'
                                        ? <HelpCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                                        : <AlertTriangle size={14} className="text-yellow-500 mt-0.5 shrink-0" />}
                                    <div className="min-w-0">
                                        <div className="text-xs text-slate-200">
                                            <span className="font-bold">{row.ticker || '—'}</span>
                                            {/* O preço unitário fica visível aqui de propósito: é a
                                                linha que o usuário confere contra o extrato. */}
                                            <span className="text-slate-500"> · {row.side === 'BUY' ? 'Compra' : 'Venda'} de{' '}
                                                {quantityFormat.format(row.quantity)}
                                                {row.price > 0 && ` × ${currencyOf(row.currency ?? 'BRL').format(row.price)}`}
                                                {' '}em {dateFormat(row.date)}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-400 mt-0.5">{row.reason}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    {actionable.length > 100 && (
                        <p className="text-[11px] text-slate-500 mt-2">
                            Mostrando os 100 primeiros de {actionable.length}.
                        </p>
                    )}
                </div>
            )}

            {actionable.length === 0 && preview.counts.ok > 0 && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
                    <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                    <p className="text-xs text-emerald-300">
                        Todos os lançamentos foram reconhecidos. Confira a posição acima e confirme.
                    </p>
                </div>
            )}
        </div>
    );
};
