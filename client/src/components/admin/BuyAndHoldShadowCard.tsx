import React from 'react';
import { RefreshCw, ShieldCheck, Play, AlertCircle, FlaskConical } from 'lucide-react';
import { researchService, type BuyAndHoldShadow } from '../../services/research';

// Card admin-only (aba Operações): ranking Buy-and-Hold em SHADOW.
// Calcula on-demand no backend (read-only); nada é publicado nem persistido.
export const BuyAndHoldShadowCard: React.FC = () => {
    const [data, setData] = React.useState<BuyAndHoldShadow | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await researchService.getBuyAndHoldShadow());
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Falha ao gerar ranking.');
        } finally {
            setLoading(false);
        }
    };

    const fmtBRL = (n: number) => `R$ ${(n / 1e9).toFixed(0)} bi`;

    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl mb-6">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-card">
                <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-emerald-500" />
                    <div>
                        <h3 className="font-bold text-white text-sm uppercase tracking-wider flex items-center gap-2">
                            Ranking Buy-and-Hold
                            <span className="flex items-center gap-1 text-[9px] font-black text-amber-400 bg-amber-900/20 border border-amber-900/50 px-1.5 py-0.5 rounded">
                                <FlaskConical size={9} /> SHADOW
                            </span>
                        </h3>
                        <p className="text-[10px] text-slate-500 mt-0.5">Âncora defensiva segura — cálculo read-only, não publica</p>
                    </div>
                </div>
                <button
                    onClick={load}
                    disabled={loading}
                    className={`px-4 py-2 rounded-xl font-black text-[11px] uppercase tracking-wider transition-all flex items-center gap-2 ${loading ? 'bg-slate-800 text-slate-400 cursor-wait border border-slate-700' : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30'}`}
                >
                    {loading ? <><RefreshCw size={13} className="animate-spin" /> Calculando...</> : <><Play size={13} fill="currentColor" /> {data ? 'Atualizar' : 'Gerar'}</>}
                </button>
            </div>

            {error && (
                <div className="p-4 flex items-center gap-2 text-xs text-red-400 bg-red-900/10 border-b border-red-900/30">
                    <AlertCircle size={14} /> {error}
                </div>
            )}

            {!data && !error && (
                <div className="p-8 text-center text-xs text-slate-500">
                    Clique em <span className="font-bold text-slate-400">Gerar</span> para calcular o ranking Buy-and-Hold a partir dos dados atuais.
                </div>
            )}

            {data && (
                <>
                    <div className="p-4 flex flex-wrap items-center gap-3 border-b border-slate-800/60 bg-card/40 text-[10px]">
                        <Chip label="Analisados" value={data.counts.analyzed} />
                        <Chip label="Elegíveis" value={data.counts.eligible} tone="emerald" />
                        <Chip label="BUY" value={data.counts.buy} tone="emerald" />
                        <Chip label="WAIT" value={data.counts.wait} tone="yellow" />
                        <Chip label="Excluídos" value={data.counts.excluded} tone="slate" />
                        <span className="ml-auto text-slate-600">
                            Selic {data.macro?.SELIC ?? '—'}% · gate cap ≥ {fmtBRL(data.config.minMarketCap)} · beta ≤ {data.config.maxBeta}
                        </span>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[720px]">
                            <thead>
                                <tr className="bg-card border-b border-slate-800 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                    <th scope="col" className="px-4 py-2.5">#</th>
                                    <th scope="col" className="px-4 py-2.5">Ativo</th>
                                    <th scope="col" className="px-3 py-2.5 text-center">Score</th>
                                    <th scope="col" className="px-3 py-2.5 text-center">Ação</th>
                                    <th scope="col" className="px-3 py-2.5 text-center" title="Durabilidade / Resiliência / Consistência">Eixos D/R/C</th>
                                    <th scope="col" className="px-3 py-2.5 text-center" title="Prêmio sobre o valor justo (negativo = desconto)">Prêmio</th>
                                    <th scope="col" className="px-4 py-2.5">Motivo</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/50">
                                {data.ranking.map((row) => (
                                    <tr key={row.ticker} className="hover:bg-slate-900/20 transition-colors">
                                        <td className="px-4 py-2.5 text-slate-600 font-mono text-[10px]">{row.position}</td>
                                        <td className="px-4 py-2.5">
                                            <span className="text-xs font-bold text-slate-200">{row.ticker}</span>
                                            <span className="block text-[9px] text-slate-500">{row.sector}{row.archetype ? ` · ${row.archetype}` : ''}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className="text-sm font-black text-white">{row.score}</span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${row.action === 'BUY' ? 'text-emerald-400 bg-emerald-900/20 border border-emerald-900/50' : 'text-yellow-400 bg-yellow-900/20 border border-yellow-900/50'}`}>
                                                {row.action}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[10px] font-mono text-slate-400">
                                            {row.axes.durability}/{row.axes.resilience}/{row.axes.consistency}
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[10px] font-mono">
                                            <span className={row.premiumPct === null ? 'text-slate-600' : row.premiumPct > 5 ? 'text-red-400' : 'text-emerald-400'}>
                                                {row.premiumPct === null ? '—' : `${row.premiumPct > 0 ? '+' : ''}${row.premiumPct}%`}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2.5 text-[10px] text-slate-500 max-w-xs truncate" title={row.reason}>{row.reason}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-3 border-t border-slate-800/60 flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-slate-600">
                        <span className="font-bold text-slate-500">Excluídos por motivo:</span>
                        {data.excludedByReason.slice(0, 6).map((e) => (
                            <span key={e.reason}>{e.reason} <span className="text-slate-400 font-bold">{e.count}</span></span>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const Chip = ({ label, value, tone = 'blue' }: { label: string; value: number; tone?: 'blue' | 'emerald' | 'yellow' | 'slate' }) => {
    const tones: Record<string, string> = {
        blue: 'text-blue-400 border-blue-900/50 bg-blue-900/10',
        emerald: 'text-emerald-400 border-emerald-900/50 bg-emerald-900/10',
        yellow: 'text-yellow-400 border-yellow-900/50 bg-yellow-900/10',
        slate: 'text-slate-400 border-slate-700 bg-slate-800/40',
    };
    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border font-bold ${tones[tone]}`}>
            {label} <span className="text-white font-black">{value}</span>
        </span>
    );
};
