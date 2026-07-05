
import React, { useEffect, useState, useCallback } from 'react';
import { walletService } from '../../services/wallet';
import { useDemo } from '../../contexts/DemoContext';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency as fmtCurrency } from '../../utils/format';
import {
    FileText, Download, Landmark, Receipt, Coins, AlertTriangle,
    Info, Loader2, ChevronDown,
} from 'lucide-react';

// --- Tipos do relatório (espelham server/services/taxReportService.js) ---
interface TaxPosition {
    ticker: string; name: string; type: string; currency: string;
    quantity: number; avgPrice: number; totalCost: number;
    grupo: string; codigo: string; groupLabel: string; manualReview: boolean;
}
interface TaxGroup { groupLabel: string; grupo: string; items: TaxPosition[]; totalCost: number; exterior: boolean; }
interface TaxMonthly {
    month: string; category: string; sales: number; gain: number;
    exempt: boolean; compensatedLoss: number; taxableBase: number; taxRate: number; tax: number; lossCarryAfter: number;
}
interface TaxDarf { month: string; competencia: string; code: string; dueDate: string; amount: number; breakdown: { category: string; tax: number }[]; }
interface TaxReportData {
    year: number;
    positionsByGroup: TaxGroup[];
    monthly: TaxMonthly[];
    darf: TaxDarf[];
    darfCarryToNextYear: number;
    dividends: { total: number; byTicker: { ticker: string; name: string; type: string; amount: number }[] };
    lossCarryEndOfYear: { ACOES: number; FII: number; ETF: number };
    manualReviewItems: { category: string; realizedGain: number; sales: number }[];
    summary: { totalDarf: number; totalDividends: number; totalPositionCostBRL: number; positionsCount: number };
    disclaimers: string[];
}

const MONTH_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CATEGORY_PT: Record<string, string> = { ACOES: 'Ações', FII: 'FIIs', ETF: 'ETF', EXTERIOR: 'Exterior', CRIPTO: 'Cripto' };

const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => currentYear - i);

const fmt = (v: number) => fmtCurrency(v || 0);
const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

export const TaxReport = () => {
    const { isDemoMode } = useDemo();
    const { addToast } = useToast();
    // Padrão: ano-base anterior (a declaração corrente é sobre o ano encerrado).
    const [year, setYear] = useState<number>(currentYear - 1);
    const [data, setData] = useState<TaxReportData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showDisclaimers, setShowDisclaimers] = useState(false);

    const load = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await walletService.getTaxReport(year);
            setData(res);
        } catch (e: any) {
            setError(e?.message || 'Falha ao gerar o relatório de IR.');
            setData(null);
        } finally {
            setIsLoading(false);
        }
    }, [year]);

    useEffect(() => {
        if (isDemoMode) { setIsLoading(false); return; }
        load();
    }, [isDemoMode, load]);

    const handleDownload = async () => {
        if (isDemoMode) { addToast('O relatório de IR usa os dados reais da sua carteira.', 'info'); return; }
        setIsDownloading(true);
        try {
            await walletService.downloadTaxReportPdf(year);
            addToast('PDF gerado com sucesso.', 'success');
        } catch (e: any) {
            addToast(e?.message || 'Falha ao gerar o PDF.', 'error');
        } finally {
            setIsDownloading(false);
        }
    };

    if (isDemoMode) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl p-10 text-center">
                <FileText size={32} className="text-gold mx-auto mb-3" />
                <p className="text-sm text-white font-bold mb-1">Relatório de Imposto de Renda</p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                    O relatório de IR é gerado a partir dos dados reais da sua carteira (posição em 31/12, ganhos realizados, proventos e DARF). Saia do modo demonstração para utilizá-lo.
                </p>
            </div>
        );
    }

    const hasLoss = data && (data.lossCarryEndOfYear.ACOES > 0 || data.lossCarryEndOfYear.FII > 0 || data.lossCarryEndOfYear.ETF > 0);

    return (
        <div className="space-y-6">
            {/* Cabeçalho: seletor de ano + exportar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText size={18} className="text-gold" /> Imposto de Renda
                    </h2>
                    <p className="text-xs text-slate-500">Apoio à declaração: posição em 31/12, ganhos realizados, proventos e DARF.</p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="appearance-none bg-card border border-slate-800 rounded-lg pl-3 pr-8 py-2 text-xs font-bold text-white outline-none focus:border-gold cursor-pointer"
                            aria-label="Ano-base"
                        >
                            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>Ano-base {y}</option>)}
                        </select>
                        <ChevronDown size={14} className="absolute right-2 top-2.5 text-slate-500 pointer-events-none" />
                    </div>
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading || isLoading || !data}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-gold/20 text-gold border border-gold/50 hover:bg-gold/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isDownloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        Exportar PDF
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 bg-base border border-slate-800 rounded-2xl animate-pulse" />)}
                    </div>
                    <div className="h-64 bg-base border border-slate-800 rounded-2xl animate-pulse" />
                </div>
            ) : error ? (
                <div className="bg-base border border-red-900/40 rounded-2xl p-8 text-center">
                    <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
                    <p className="text-sm text-white font-bold mb-1">Não foi possível gerar o relatório</p>
                    <p className="text-xs text-slate-500 mb-4">{error}</p>
                    <button onClick={load} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-800 text-white hover:bg-slate-700 transition-all">
                        Tentar novamente
                    </button>
                </div>
            ) : data ? (
                <>
                    {/* Cards de resumo */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <SummaryCard label="DARF a pagar (ano)" value={fmt(data.summary.totalDarf)} accent={data.summary.totalDarf > 0 ? 'emerald' : 'slate'} />
                        <SummaryCard label="Proventos isentos" value={fmt(data.summary.totalDividends)} accent="slate" />
                        <SummaryCard label="Custo posição 31/12" value={fmt(data.summary.totalPositionCostBRL)} accent="slate" />
                        <SummaryCard label="Ativos declarados" value={String(data.summary.positionsCount)} accent="slate" />
                    </div>

                    {/* Bens e Direitos */}
                    <Section icon={<Landmark size={16} className="text-blue-400" />} title="Bens e Direitos — Posição em 31/12"
                        subtitle="Declare pelo CUSTO DE AQUISIÇÃO (preço médio), não pelo valor de mercado.">
                        {data.positionsByGroup.length === 0 ? (
                            <Empty text="Nenhuma posição em aberto em 31/12." />
                        ) : (
                            <div className="space-y-5">
                                {data.positionsByGroup.map((g) => (
                                    <div key={g.groupLabel}>
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-bold text-blue-400">Grupo {g.grupo} — {g.groupLabel}</span>
                                            <span className="text-xs font-bold text-white tabular-nums">{fmt(g.totalCost)}</span>
                                        </div>
                                        <div className="overflow-x-auto custom-scrollbar">
                                            <table className="w-full text-xs min-w-[480px]">
                                                <thead>
                                                    <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                                                        <th className="text-left font-semibold py-1.5">Ativo</th>
                                                        <th className="text-right font-semibold py-1.5">Quantidade</th>
                                                        <th className="text-right font-semibold py-1.5">Preço médio</th>
                                                        <th className="text-right font-semibold py-1.5">Custo total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {g.items.map((p) => (
                                                        <tr key={p.ticker} className="border-b border-slate-800/40">
                                                            <td className="py-2 text-white font-bold">
                                                                {p.ticker}
                                                                {p.manualReview && <span className="ml-2 text-[9px] text-amber-400 font-normal">(conferir câmbio)</span>}
                                                            </td>
                                                            <td className="py-2 text-right text-slate-300 tabular-nums">{p.quantity % 1 === 0 ? p.quantity : p.quantity.toFixed(6)}</td>
                                                            <td className="py-2 text-right text-slate-300 tabular-nums">{fmt(p.avgPrice)}</td>
                                                            <td className="py-2 text-right text-white tabular-nums font-bold">{fmt(p.totalCost)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>

                    {/* Ganhos de Renda Variável + DARF */}
                    <Section icon={<Receipt size={16} className="text-emerald-400" />} title="Ganhos em Renda Variável (Brasil)"
                        subtitle="Apuração mensal por preço médio. Ações: isenção de vendas ≤ R$20.000/mês (15%). FIIs: 20%. ETF: 15%.">
                        {data.monthly.length === 0 ? (
                            <Empty text="Nenhuma venda de renda variável brasileira no ano." />
                        ) : (
                            <>
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-xs min-w-[560px]">
                                        <thead>
                                            <tr className="text-[10px] uppercase text-slate-500 border-b border-slate-800">
                                                <th className="text-left font-semibold py-1.5">Mês</th>
                                                <th className="text-left font-semibold py-1.5">Categoria</th>
                                                <th className="text-right font-semibold py-1.5">Vendas</th>
                                                <th className="text-right font-semibold py-1.5">Ganho/Perda</th>
                                                <th className="text-right font-semibold py-1.5">Base trib.</th>
                                                <th className="text-right font-semibold py-1.5">Imposto</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.monthly.map((l, idx) => (
                                                <tr key={`${l.month}-${l.category}-${idx}`} className="border-b border-slate-800/40">
                                                    <td className="py-2 text-slate-300">{MONTH_PT[parseInt(l.month, 10) - 1]}</td>
                                                    <td className="py-2 text-slate-300">{CATEGORY_PT[l.category] || l.category}</td>
                                                    <td className="py-2 text-right text-slate-300 tabular-nums">{fmt(l.sales)}</td>
                                                    <td className={`py-2 text-right tabular-nums ${l.gain < 0 ? 'text-red-400' : 'text-slate-300'}`}>{fmt(l.gain)}</td>
                                                    <td className="py-2 text-right tabular-nums">
                                                        {l.exempt ? <span className="text-emerald-400">isento</span> : <span className="text-slate-300">{fmt(l.taxableBase)}</span>}
                                                    </td>
                                                    <td className={`py-2 text-right tabular-nums font-bold ${l.tax > 0 ? 'text-white' : 'text-slate-600'}`}>{l.tax > 0 ? fmt(l.tax) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* DARFs */}
                                <div className="mt-5 pt-4 border-t border-slate-800">
                                    <p className="text-xs font-bold text-white mb-3">DARFs a recolher</p>
                                    {data.darf.length === 0 ? (
                                        <p className="text-xs text-slate-500">Nenhum DARF devido (imposto acumulado abaixo de R$10 ou sem ganho tributável).</p>
                                    ) : (
                                        <div className="space-y-2">
                                            {data.darf.map((d) => (
                                                <div key={d.competencia} className="flex flex-wrap items-center justify-between gap-2 p-3 bg-panel rounded-xl border border-slate-800/50">
                                                    <div className="flex items-center gap-3 text-xs">
                                                        <span className="text-white font-bold">Competência {MONTH_PT[parseInt(d.month, 10) - 1]}/{data.year}</span>
                                                        <span className="text-slate-500">Código {d.code}</span>
                                                        <span className="text-slate-500">Venc. {fmtDate(d.dueDate)}</span>
                                                    </div>
                                                    <span className="text-sm font-bold text-emerald-400 tabular-nums">{fmt(d.amount)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {data.darfCarryToNextYear > 0 && (
                                        <p className="text-[11px] text-slate-500 mt-3">
                                            Imposto de {fmt(data.darfCarryToNextYear)} ficou abaixo de R$10,00 e deve ser somado ao DARF do próximo mês.
                                        </p>
                                    )}
                                    {hasLoss && (
                                        <p className="text-[11px] text-slate-400 mt-2">
                                            Prejuízo a compensar em anos seguintes — Ações: <b className="text-white">{fmt(data.lossCarryEndOfYear.ACOES)}</b> · FIIs: <b className="text-white">{fmt(data.lossCarryEndOfYear.FII)}</b> · ETF: <b className="text-white">{fmt(data.lossCarryEndOfYear.ETF)}</b>.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}
                    </Section>

                    {/* Proventos isentos */}
                    <Section icon={<Coins size={16} className="text-gold" />} title="Rendimentos Isentos — Proventos"
                        subtitle="Dividendos e rendimentos de FIIs recebidos no ano.">
                        {data.dividends.byTicker.length === 0 ? (
                            <Empty text="Nenhum provento recebido no ano." />
                        ) : (
                            <div className="space-y-1.5">
                                {data.dividends.byTicker.map((d) => (
                                    <div key={d.ticker} className="flex items-center justify-between py-1.5 border-b border-slate-800/40">
                                        <div className="flex items-baseline gap-2 min-w-0">
                                            <span className="text-xs font-bold text-white">{d.ticker}</span>
                                            <span className="text-[11px] text-slate-500 truncate">{d.name}</span>
                                        </div>
                                        <span className="text-xs text-slate-300 tabular-nums">{fmt(d.amount)}</span>
                                    </div>
                                ))}
                                <div className="flex items-center justify-between pt-3">
                                    <span className="text-xs font-bold text-white">Total de proventos isentos</span>
                                    <span className="text-sm font-bold text-emerald-400 tabular-nums">{fmt(data.dividends.total)}</span>
                                </div>
                            </div>
                        )}
                    </Section>

                    {/* Conferência manual */}
                    {data.manualReviewItems.length > 0 && (
                        <Section icon={<AlertTriangle size={16} className="text-amber-400" />} title="Conferência Manual — Exterior e Cripto"
                            subtitle="Ganho de capital NÃO calculado (regras próprias). Valores informativos.">
                            <div className="space-y-2">
                                {data.manualReviewItems.map((m) => (
                                    <div key={m.category} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <span className="text-white font-bold">{CATEGORY_PT[m.category] || m.category}</span>
                                        <span className="text-slate-500">Vendas no ano: <span className="tabular-nums">{fmt(m.sales)}</span></span>
                                        <span className="text-slate-300">Resultado: <span className="tabular-nums">{fmt(m.realizedGain)}</span></span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                                Exterior e cripto têm isenção de R$35.000/mês em vendas e regras próprias (GCAP / carnê-leão). Apure separadamente e consulte um contador.
                            </p>
                        </Section>
                    )}

                    {/* Avisos */}
                    <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden">
                        <button
                            onClick={() => setShowDisclaimers((v) => !v)}
                            className="w-full flex items-center justify-between p-4 text-left"
                        >
                            <span className="flex items-center gap-2 text-xs font-bold text-slate-300">
                                <Info size={14} className="text-slate-500" /> Avisos importantes e metodologia
                            </span>
                            <ChevronDown size={16} className={`text-slate-500 transition-transform ${showDisclaimers ? 'rotate-180' : ''}`} />
                        </button>
                        {showDisclaimers && (
                            <ul className="px-4 pb-4 space-y-2 list-decimal list-inside">
                                {data.disclaimers.map((d, i) => (
                                    <li key={i} className="text-[11px] text-slate-500 leading-relaxed">{d}</li>
                                ))}
                            </ul>
                        )}
                    </div>
                </>
            ) : null}
        </div>
    );
};

const SummaryCard = ({ label, value, accent }: { label: string; value: string; accent: 'emerald' | 'slate' }) => (
    <div className="bg-base border border-slate-800 rounded-2xl p-4">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</p>
        <p className={`text-lg font-bold tabular-nums ${accent === 'emerald' ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
    </div>
);

const Section = ({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string; children: React.ReactNode }) => (
    <div className="bg-base border border-slate-800 rounded-2xl p-6">
        <div className="mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">{icon} {title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {children}
    </div>
);

const Empty = ({ text }: { text: string }) => (
    <p className="text-xs text-slate-600 py-4 text-center">{text}</p>
);
