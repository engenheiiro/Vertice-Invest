import React, { useEffect, useRef, useState } from 'react';
import { Settings, HardDrive, Scissors, ShieldAlert, ClipboardList, Search, RefreshCw, Zap, Trash2, Play, CalendarClock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TunablesCard } from '../../components/admin/TunablesCard';
import { useDemo } from '../../contexts/DemoContext';
import { useToast } from '../../contexts/ToastContext';
import { researchService, type DividendPaymentBackfillState } from '../../services/research';
import { getErrorMessage } from '../../utils/errorMessages';
import type { BillingMode } from '../../services/subscription';
import type { BillingCycle } from '../../constants/subscription';

/**
 * Preencher datas de pagamento de provento.
 *
 * POR QUE É UM BOTÃO E NÃO UM CRON, e por que ele NÃO tem periodicidade:
 * a B3 já roda sozinha no sync diário de proventos e cobre os últimos 12 meses,
 * então nenhum provento novo envelhece sem data. O que sobra é o passivo
 * histórico, anterior ao alcance da B3, e esse só o Fundamentus alcança — que
 * responde 403 ao IP de produção. Daí o botão: ele existe para ser clicado UMA
 * vez, do ambiente de desenvolvimento, e depois só quando o card "Data de
 * pagamento dos proventos" da aba Saúde acusar. É o painel que avisa, não o
 * calendário.
 */
const DividendPaymentDatesCard: React.FC = () => {
    const { addToast } = useToast();
    const [estado, setEstado] = useState<DividendPaymentBackfillState | null>(null);
    const [isStarting, setIsStarting] = useState(false);
    // Reinicia o acompanhamento depois de um disparo (a consulta anterior já tinha
    // parado ao ver o job terminado).
    const [ciclo, setCiclo] = useState(0);
    // O aviso de conclusão é para quem disparou. Sem estas duas travas, abrir a aba
    // sobre um backfill antigo dispararia o toast de novo, toda vez.
    const iniciadoAqui = useRef(false);
    const jaAvisou = useRef(false);

    const isRunning = estado?.status === 'RUNNING' || isStarting;
    const result = estado?.status === 'DONE' ? estado.stats : null;

    // O progresso mora no servidor, e a tela só pergunta. É isso que faz sair da
    // página não interromper nada: ao voltar, este efeito reencontra o job em
    // andamento e volta a acompanhar de onde ele parou.
    useEffect(() => {
        let vivo = true;
        let timer: ReturnType<typeof setTimeout>;

        const consultar = async () => {
            try {
                const s = await researchService.getDividendPaymentBackfillStatus();
                if (!vivo) return;
                setEstado(s);
                setIsStarting(false);
                if (s.status === 'RUNNING') {
                    timer = setTimeout(consultar, 1500);
                    return;
                }
                if (iniciadoAqui.current && !jaAvisou.current && (s.status === 'DONE' || s.status === 'ERROR')) {
                    jaAvisou.current = true;
                    addToast(
                        s.message || 'Backfill concluído.',
                        s.status === 'ERROR' ? 'error' : (s.stats?.preenchidos ? 'success' : 'info'),
                    );
                }
            } catch {
                // Falha de consulta não cancela o trabalho no servidor: tenta de novo.
                if (vivo) timer = setTimeout(consultar, 5000);
            }
        };

        consultar();
        return () => { vivo = false; clearTimeout(timer); };
    }, [addToast, ciclo]);

    const handleRun = async () => {
        setIsStarting(true);
        iniciadoAqui.current = true;
        jaAvisou.current = false;
        try {
            const res = await researchService.backfillDividendPaymentDates();
            setEstado(res.estado);
            setCiclo((c) => c + 1);
            addToast(res.message, 'info');
        } catch (error) {
            setIsStarting(false);
            addToast(getErrorMessage(error, 'Falha ao iniciar o preenchimento das datas.'), 'error');
        }
    };

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center gap-2 mb-4">
                <CalendarClock size={18} className="text-blue-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Datas de Pagamento</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">
                Busca no calendário da B3 e do Fundamentus a data em que cada provento cai na conta.
                O sync diário já faz isso pelos últimos 12 meses — este botão serve para o histórico
                mais antigo, que só o Fundamentus tem. <strong className="text-slate-300">Rode em dev:</strong> o
                Fundamentus bloqueia o IP de produção. Não tem periodicidade; clique quando a aba Saúde acusar.
            </p>
            <button
                onClick={handleRun}
                disabled={isRunning}
                className="w-full py-2 bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 hover:text-blue-300 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isRunning ? <RefreshCw size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                {isRunning ? 'Consultando fonte por fonte…' : 'Preencher datas de pagamento'}
            </button>
            {isRunning && (
                <div className="mt-3 space-y-1.5">
                    {/* A fila só é conhecida depois da primeira consulta ao banco;
                        até lá a barra fica indeterminada em vez de mentir 0%. */}
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full bg-blue-500 rounded-full ${estado?.total ? 'transition-all duration-500' : 'animate-pulse w-1/3'}`}
                            style={estado?.total ? { width: `${Math.round((estado.feitos / estado.total) * 100)}%` } : undefined}
                        />
                    </div>
                    <p className="text-[10px] text-slate-400 text-center tabular-nums">
                        {estado?.total
                            ? `${estado.feitos} de ${estado.total} ativo(s) · ${estado.preenchidos} data(s) gravada(s)${estado.ticker ? ` · ${estado.ticker}` : ''}`
                            : 'Montando a fila de ativos sem data…'}
                    </p>
                    <p className="text-[10px] text-slate-500 text-center">
                        Uma requisição por ativo, com pausa entre elas. Roda no servidor: pode sair desta
                        página que o trabalho continua.
                    </p>
                </div>
            )}
            {estado?.status === 'ERROR' && (
                <p className="mt-3 text-[10px] text-red-400 text-center">{estado.message}</p>
            )}
            {result && (
                <div className="mt-4 pt-4 border-t border-slate-800 space-y-1 text-[11px] text-slate-400">
                    <p>
                        <strong className="text-white">{result.preenchidos}</strong> data(s) gravada(s)
                        {' '}em {result.ativos} ativo(s), de {result.tentados} evento(s) sem data.
                    </p>
                    {Object.keys(result.porFonte).length > 0 && (
                        <p>Total no banco por fonte: {Object.entries(result.porFonte).map(([f, n]) => `${f} ${n}`).join(' · ')}</p>
                    )}
                    {result.bloqueioDeAcesso > 0 && (
                        <p className="text-yellow-500">
                            {result.bloqueioDeAcesso} ativo(s) com acesso bloqueado pela fonte — esperado se
                            você rodou isto em produção. Repita a partir do ambiente de desenvolvimento.
                        </p>
                    )}
                    <p className="text-slate-500">
                        O que ficou sem data segue na estimativa, marcada como “Previsto” na tela — ou o
                        emissor ainda não anunciou, ou o pagamento está dividido em datas diferentes.
                    </p>
                </div>
            )}
        </div>
    );
};

interface CacheData {
    ticker: string;
    status: 'CACHED' | 'LIVE_ONLY' | 'NOT_FOUND';
    currentPrice?: number;
    dataPoints?: number;
}

interface Props {
    backtestDays: number;
    isSavingConfig: boolean;
    isClearingRadar: boolean;
    cacheSearchTicker: string;
    setCacheSearchTicker: (v: string) => void;
    cacheData: CacheData | null;
    isSearchingCache: boolean;
    splitTicker: string;
    setSplitTicker: (v: string) => void;
    isFixingSplit: boolean;
    testPaymentLoading: string | null;
    discardLogs: any[];
    isLoadingLogs: boolean;
    onSaveBacktestConfig: (days: number) => void;
    onClearRadarHistory: () => void;
    onCacheSearch: (e: React.FormEvent) => void;
    onFixSplit: (e: React.FormEvent) => void;
    onTestPayment: (planKey: string, mode?: BillingMode, cycle?: BillingCycle) => void;
    onLoadDiscardLogs: () => void;
}

export const AdminFerramentasTab: React.FC<Props> = ({
    backtestDays, isSavingConfig, isClearingRadar,
    cacheSearchTicker, setCacheSearchTicker, cacheData, isSearchingCache,
    splitTicker, setSplitTicker, isFixingSplit,
    testPaymentLoading, discardLogs, isLoadingLogs,
    onSaveBacktestConfig, onClearRadarHistory, onCacheSearch, onFixSplit, onTestPayment, onLoadDiscardLogs,
}) => {
    const navigate = useNavigate();
    const { startDemo } = useDemo();

    const handleSimulateTutorial = () => {
        navigate('/dashboard');
        setTimeout(startDemo, 100);
    };

    return (
    <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Parâmetros operacionais editáveis */}
            <TunablesCard />

            {/* Configuração Radar */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <Settings size={18} className="text-blue-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Configuração Radar</h3>
                </div>
                <div className="mb-6">
                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Horizonte de Backtest (Dias)</p>
                    <div className="flex gap-2">
                        {[3, 7, 15, 30].map(d => (
                            <button key={d} onClick={() => onSaveBacktestConfig(d)} disabled={isSavingConfig} className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${backtestDays === d ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`}>{d}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <p className="text-[10px] text-slate-400 mb-2 font-bold uppercase">Manutenção</p>
                    <button onClick={onClearRadarHistory} disabled={isClearingRadar} className="w-full py-2 bg-red-900/10 border border-red-900/30 text-red-500 hover:bg-red-900/20 hover:text-red-400 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all">
                        {isClearingRadar ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Limpar Histórico do Radar
                    </button>
                </div>
            </div>

            {/* Inspector de Cache */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <HardDrive size={18} className="text-emerald-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Inspector de Cache</h3>
                </div>
                <form onSubmit={onCacheSearch} className="flex gap-0 relative mb-4">
                    <input placeholder="Ticker..." value={cacheSearchTicker} onChange={(e) => setCacheSearchTicker(e.target.value.toUpperCase())} className="flex-1 bg-card border border-slate-700 border-r-0 rounded-l-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase" />
                    <button type="submit" disabled={isSearchingCache} className="px-3 bg-slate-800 border border-slate-700 border-l-0 rounded-r-xl text-slate-300 hover:text-white">
                        {isSearchingCache ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                    </button>
                </form>
                {cacheData && (
                    <div className="p-3 bg-panel rounded-xl border border-slate-800 space-y-1">
                        <div className="flex justify-between font-bold text-white">
                            <span>{cacheData.ticker}</span>
                            <span className={`text-[9px] px-1.5 rounded ${cacheData.status === 'CACHED' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-400'}`}>{cacheData.status}</span>
                        </div>
                        <p className="text-xs text-slate-400">Price: {cacheData.currentPrice?.toFixed(2)}</p>
                        <p className="text-[10px] text-slate-600">Points: {cacheData.dataPoints}</p>
                    </div>
                )}
            </div>

            {/* Reparar Splits */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <Scissors size={18} className="text-yellow-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Reparar Splits</h3>
                </div>
                <p className="text-[10px] text-slate-400 mb-4">Corrige histórico de usuários pós-split.</p>
                <form onSubmit={onFixSplit} className="flex gap-2">
                    <input placeholder="Ticker" value={splitTicker} onChange={(e) => setSplitTicker(e.target.value.toUpperCase())} className="flex-1 bg-card border border-slate-700 rounded-xl px-4 py-2 text-sm text-white focus:outline-none font-mono uppercase" />
                    <button type="submit" disabled={isFixingSplit || !splitTicker} className="px-3 py-2 bg-yellow-600/20 text-yellow-500 border border-yellow-600/30 rounded-xl hover:text-white hover:bg-yellow-600/40 transition-colors"><Zap size={16} /></button>
                </form>
            </div>

            {/* Simular Tutorial (Onboarding) */}
            <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
                <div className="flex items-center gap-2 mb-4">
                    <Play size={18} className="text-blue-500" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Simular Tutorial</h3>
                </div>
                <p className="text-[10px] text-slate-400 mb-4">Inicia o tour de onboarding (modo demonstração) a partir do Terminal, como um novo usuário veria.</p>
                <button onClick={handleSimulateTutorial} className="w-full py-2 bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 hover:text-blue-300 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all">
                    <Play size={14} fill="currentColor" />
                    Iniciar Demonstração
                </button>
            </div>

            <DividendPaymentDatesCard />
        </div>

        {/* Testar Pagamento */}
        <div className="bg-base border border-amber-900/30 rounded-2xl p-6 shadow-lg mb-6">
            <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={18} className="text-amber-500" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Testar Pagamento (R$0,50)</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">Gera um checkout real no Mercado Pago com valor mínimo. O webhook ativa o plano correto ao aprovar. O cartão precisa ser de outra pessoa: o Mercado Pago recusa pagamento do vendedor para a própria conta.</p>

            {/* Dois fluxos distintos do MP (Preference x PreApproval), com webhooks
                distintos: aprovar um não valida o outro. */}
            {([
                { mode: 'ONE_TIME' as const, cycle: 'MONTHLY' as const, title: 'Avulso (Pix) — 30 dias', hint: 'Preference · tópico payment' },
                { mode: 'RECURRING' as const, cycle: 'MONTHLY' as const, title: 'Assinatura (Cartão) — recorrente', hint: 'PreApproval · tópicos subscription_*' },
                { mode: 'ONE_TIME' as const, cycle: 'ANNUAL' as const, title: 'Anual (Cartão 12× ou Pix) — 365 dias', hint: 'Preference parcelada · tópico payment' },
            ]).map(({ mode, cycle, title, hint }) => (
                <div key={`${mode}:${cycle}`} className="mb-4 last:mb-0">
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">{title}</span>
                        <span className="text-[9px] text-slate-600 font-mono">{hint}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                            { key: 'ESSENTIAL', label: 'Essential', color: 'blue' },
                            { key: 'PRO', label: 'Pro', color: 'emerald' },
                            { key: 'ELITE', label: 'Elite', color: 'purple' },
                            { key: 'BLACK', label: 'Black', color: 'gold' },
                        // O Black saiu da venda e nunca teve ciclo anual: oferecer o
                        // botão daria um 400 do servidor, não um teste.
                        ].filter(({ key }) => !(cycle === 'ANNUAL' && key === 'BLACK')).map(({ key, label, color }) => (
                            <button key={key} onClick={() => onTestPayment(key, mode, cycle)} disabled={testPaymentLoading !== null} className={`py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${color === 'blue' ? 'bg-blue-900/20 border-blue-700/40 text-blue-400 hover:bg-blue-900/40' : ''} ${color === 'emerald' ? 'bg-emerald-900/20 border-emerald-700/40 text-emerald-400 hover:bg-emerald-900/40' : ''} ${color === 'purple' ? 'bg-purple-900/20 border-purple-700/40 text-purple-400 hover:bg-purple-900/40' : ''} ${color === 'gold' ? 'bg-gold/10 border-gold/40 text-gold hover:bg-gold/20' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}>
                                {testPaymentLoading === `${key}:${mode}:${cycle}` ? <RefreshCw size={13} className="animate-spin" /> : null}
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
        </div>

        {/* Log de Descartes */}
        <div className="bg-base border border-slate-800 rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2"><ClipboardList size={18} className="text-red-500" />Log de Descartes (Quality Gate)</h3>
                <button onClick={onLoadDiscardLogs} className="text-xs font-bold text-blue-500 hover:text-white flex items-center gap-1">
                    <RefreshCw size={12} className={isLoadingLogs ? 'animate-spin' : ''} /> Atualizar
                </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-[300px] custom-scrollbar">
                <table className="w-full text-left text-xs">
                    <thead className="bg-card sticky top-0 z-10">
                        <tr>
                            <th scope="col" className="p-3 font-bold text-slate-500 uppercase">Data</th>
                            <th scope="col" className="p-3 font-bold text-slate-500 uppercase">Ativo</th>
                            <th scope="col" className="p-3 font-bold text-slate-500 uppercase">Motivo</th>
                            <th scope="col" className="p-3 font-bold text-slate-500 uppercase">Detalhe</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 bg-deep">
                        {discardLogs.length === 0 ? (
                            <tr><td colSpan={4} className="p-8 text-center text-slate-500">Nenhum descarte recente.</td></tr>
                        ) : (
                            discardLogs.map((log: any) => (
                                <tr key={log._id} className="hover:bg-slate-900/30">
                                    <td className="p-3 text-slate-400 font-mono w-32">{new Date(log.createdAt).toLocaleString()}</td>
                                    <td className="p-3 text-white font-bold w-24">{log.ticker}</td>
                                    <td className="p-3 text-red-400 font-bold">{log.reason}</td>
                                    <td className="p-3 text-slate-500">{log.details}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </>
    );
};
