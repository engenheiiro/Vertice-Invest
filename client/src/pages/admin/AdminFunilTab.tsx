import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, TrendingUp, Users, Wallet, CreditCard } from 'lucide-react';
import { funnelService, type FunnelReport } from '../../services/funnel';
import { useToast } from '../../contexts/ToastContext';
import { getErrorMessage } from '../../utils/errorMessages';

/**
 * Aba "Funil" do Admin — o painel mínimo de decisão do plano comercial.
 *
 * A regra de leitura da tela é uma só: **nunca mostrar um número sem dizer se
 * ele já significa alguma coisa**. Coorte que ainda não fechou 30 dias aparece
 * marcada, taxa sem base aparece como "—" (e não como 0%), e churn medido sobre
 * três vencimentos vem com aviso. Um painel novo, num produto novo, é quase todo
 * feito de números que ainda não sustentam decisão — apresentá-los como se
 * sustentassem é o jeito mais rápido de mexer no preço pelo motivo errado.
 */

const percentual = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `null` vira "—", nunca "0,0%": "sem base" e "zero por cento" pedem ações opostas. */
const pct = (valor: number | null | undefined) =>
    valor === null || valor === undefined ? '—' : percentual.format(valor);

const brl = (valor: number | null | undefined) =>
    valor === null || valor === undefined
        ? '—'
        : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

const mesLegivel = (chave: string) => {
    const [ano, mes] = chave.split('-');
    const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return `${nomes[Number(mes) - 1] ?? mes}/${ano}`;
};

const Kpi: React.FC<{ label: string; value: string; hint?: string; Icon: React.ElementType }> = ({
    label, value, hint, Icon,
}) => (
    // O cartão é endereçável por rótulo (leitor de tela e teste): os mesmos
    // números e nomes se repetem nas tabelas logo abaixo.
    <div role="group" aria-label={label} className="bg-card border border-slate-800 rounded-xl p-4">
        <div className="flex items-center gap-2 text-slate-400 text-[11px] font-bold uppercase tracking-wider">
            <Icon size={14} /> {label}
        </div>
        <p className="text-2xl font-extrabold text-slate-100 mt-2">{value}</p>
        {hint && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{hint}</p>}
    </div>
);

export const AdminFunilTab = () => {
    const { addToast } = useToast();
    const [report, setReport] = useState<FunnelReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [months, setMonths] = useState(12);

    const carregar = async (janela: number) => {
        setIsLoading(true);
        try {
            setReport(await funnelService.getFunnel(janela));
        } catch (error) {
            addToast(getErrorMessage(error, 'Falha ao carregar o funil.'), 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { void carregar(months); }, [months]);

    if (isLoading && !report) {
        return <p className="text-slate-400 text-sm py-10 text-center">Lendo o funil…</p>;
    }
    if (!report) {
        return <p className="text-slate-400 text-sm py-10 text-center">Sem dados de funil no momento.</p>;
    }

    const { averages, cohorts, revenue, retention, acquisition, totals } = report;
    const semCoorteMadura = averages.cohorts === 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h3 className="text-slate-100 font-bold">Funil comercial</h3>
                    <p className="text-[11px] text-slate-500">
                        Lido do nosso banco — todo mundo entra, não só quem aceitou o Analytics.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={months}
                        onChange={(e) => setMonths(Number(e.target.value))}
                        aria-label="Janela de meses"
                        className="bg-panel border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-2"
                    >
                        {[6, 12, 24].map((m) => <option key={m} value={m}>Últimos {m} meses</option>)}
                    </select>
                    <button
                        onClick={() => void carregar(months)}
                        className="flex items-center gap-2 px-3 py-2 bg-panel border border-slate-700 hover:border-slate-500 text-slate-300 text-xs font-bold rounded-lg transition-colors"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Atualizar
                    </button>
                </div>
            </div>

            {semCoorteMadura && (
                <div className="flex gap-3 bg-yellow-900/10 border border-yellow-900/40 rounded-xl p-4">
                    <AlertTriangle size={18} className="text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-200/90 leading-relaxed">
                        Nenhuma coorte fechou os {report.conversionWindowDays} dias de janela ainda. As taxas abaixo
                        são parciais por construção — não servem para decidir preço nem canal.
                    </p>
                </div>
            )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Kpi
                    label="Cadastros"
                    Icon={Users}
                    value={String(totals.signupsInWindow)}
                    hint={`${totals.allTimeSignups} desde sempre`}
                />
                <Kpi
                    label="Ativação"
                    Icon={Wallet}
                    value={pct(averages.activationRate)}
                    hint="Lançou ao menos um ativo (a carteira vazia nasce com a conta)"
                />
                <Kpi
                    label={`Conversão ${report.conversionWindowDays}d`}
                    Icon={TrendingUp}
                    value={pct(averages.conversionRate)}
                    hint={semCoorteMadura ? 'Sem coorte fechada' : `Média de ${averages.cohorts} coorte(s) madura(s)`}
                />
                <Kpi
                    label="MRR"
                    Icon={CreditCard}
                    value={brl(revenue.mrr)}
                    hint={`${revenue.subscribers} assinante(s) · ARPU ${brl(revenue.arpu)}`}
                />
            </div>

            <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800">
                    <h4 className="text-slate-200 text-sm font-bold">Coortes por mês de cadastro</h4>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 uppercase text-[10px] tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-2">Mês</th>
                                <th className="text-right px-4 py-2">Cadastros</th>
                                <th className="text-right px-4 py-2">Ativaram</th>
                                <th className="text-right px-4 py-2">Ativação</th>
                                <th className="text-right px-4 py-2">Pagos {report.conversionWindowDays}d</th>
                                <th className="text-right px-4 py-2">Conversão</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cohorts.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Nenhum cadastro na janela.</td></tr>
                            )}
                            {cohorts.map((c) => (
                                <tr key={c.monthKey} className="border-t border-slate-800/60">
                                    <td className="px-4 py-2 text-slate-300 font-medium">
                                        {mesLegivel(c.monthKey)}
                                        {!c.matureFor30d && (
                                            <span
                                                title={`Ainda dentro dos ${report.conversionWindowDays} dias de janela`}
                                                className="ml-2 px-1.5 py-0.5 rounded bg-yellow-900/30 text-yellow-400 text-[9px] font-bold uppercase"
                                            >
                                                em curso
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-4 py-2 text-right text-slate-300">{c.signups}</td>
                                    <td className="px-4 py-2 text-right text-slate-400">{c.activated}</td>
                                    <td className="px-4 py-2 text-right text-slate-300">{pct(c.activationRate)}</td>
                                    <td className="px-4 py-2 text-right text-slate-400">{c.paid30d}</td>
                                    <td className={`px-4 py-2 text-right font-bold ${c.matureFor30d ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        {pct(c.conversionRate)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
                <div className="bg-card border border-slate-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-800">
                        <h4 className="text-slate-200 text-sm font-bold">Origem do cadastro</h4>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                            Congelada no primeiro toque. Quem chega sem marcação entra como "direto".
                        </p>
                    </div>
                    <table className="w-full text-xs">
                        <thead className="text-slate-500 uppercase text-[10px] tracking-wider">
                            <tr>
                                <th className="text-left px-4 py-2">Origem</th>
                                <th className="text-right px-4 py-2">Cadastros</th>
                                <th className="text-right px-4 py-2">Ativação</th>
                                <th className="text-right px-4 py-2">Pagaram</th>
                            </tr>
                        </thead>
                        <tbody>
                            {acquisition.map((linha) => (
                                <tr key={linha.source} className="border-t border-slate-800/60">
                                    <td className="px-4 py-2 text-slate-300">{linha.source}</td>
                                    <td className="px-4 py-2 text-right text-slate-300">{linha.signups}</td>
                                    <td className="px-4 py-2 text-right text-slate-400">{pct(linha.activationRate)}</td>
                                    <td className="px-4 py-2 text-right text-slate-400">{linha.paid}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="bg-card border border-slate-800 rounded-xl p-4 space-y-3">
                    <h4 className="text-slate-200 text-sm font-bold">Retenção e receita</h4>
                    <dl className="text-xs space-y-2">
                        <div className="flex justify-between"><dt className="text-slate-400">Assinaturas vigentes</dt><dd className="text-slate-200 font-bold">{retention.activeNow}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-400">Venceram nos últimos 30 dias</dt><dd className="text-slate-200 font-bold">{retention.dueInWindow}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-400">Renovaram</dt><dd className="text-emerald-400 font-bold">{retention.renewed}</dd></div>
                        <div className="flex justify-between"><dt className="text-slate-400">Não voltaram</dt><dd className="text-red-400 font-bold">{retention.lost}</dd></div>
                        <div className="flex justify-between border-t border-slate-800 pt-2">
                            <dt className="text-slate-300 font-bold">Churn</dt>
                            <dd className="text-slate-100 font-bold">{pct(retention.churnRate)}</dd>
                        </div>
                    </dl>
                    {!retention.significant && (
                        <p className="text-[11px] text-yellow-200/80 bg-yellow-900/10 border border-yellow-900/40 rounded-lg p-2 leading-relaxed">
                            Base pequena demais para churn significar algo: com poucos vencimentos, uma saída vira
                            dezenas de pontos percentuais.
                        </p>
                    )}
                    <div className="border-t border-slate-800 pt-3">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider font-bold mb-2">MRR por plano</p>
                        {Object.keys(revenue.byPlan).length === 0 && (
                            <p className="text-xs text-slate-500">Nenhuma assinatura vigente.</p>
                        )}
                        {Object.entries(revenue.byPlan).map(([plano, dados]) => (
                            <div key={plano} className="flex justify-between text-xs py-1">
                                <span className="text-slate-400">{plano} <span className="text-slate-600">({dados.subscribers})</span></span>
                                <span className="text-slate-200 font-medium">{brl(dados.mrr)}</span>
                            </div>
                        ))}
                        <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                            O anual entra dividido por 12: contá-lo inteiro no mês da compra criaria um pico e
                            onze meses de deserto.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
