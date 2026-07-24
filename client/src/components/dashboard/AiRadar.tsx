
import React, { useState, useMemo, useEffect } from 'react';
import { Radar, Zap, Lock, Shield, Activity, Crown, Info, History, Medal, TrendingUp, Clock } from 'lucide-react';
import { AiSignal, RadarMeta, SignalAccess } from '../../hooks/useDashboardData';
import { useNavigate } from 'react-router-dom';
import AssetLogo from '../common/AssetLogo';
import type { AssetType } from '../../contexts/WalletContext';

interface AiRadarProps {
    signals: AiSignal[];
    isLoading?: boolean;
    meta?: RadarMeta | null;
    // Nível decidido pelo backend. O ESSENTIAL ('DELAYED') recebe sinais reais
    // com defasagem, então tem acesso à lista completa — só não em tempo real.
    access?: SignalAccess;
}

type FilterType = 'ALL' | 'STOCK' | 'FII' | 'STOCK_US' | 'CRYPTO' | 'FIXED_INCOME';

const getTypeLabel = (type: string) => {
    if (type === 'FII') return 'FII';
    if (type === 'STOCK_US') return 'Exterior';
    if (type === 'CRYPTO') return 'Cripto';
    if (type === 'FIXED_INCOME') return 'RF';
    return 'Ação';
};

// Countdown para a próxima varredura — decrementa localmente a cada segundo
const ScanCountdown: React.FC<{ nextScanAt: string | null }> = ({ nextScanAt }) => {
    const [display, setDisplay] = useState('--:--');

    useEffect(() => {
        if (!nextScanAt) {
            setDisplay('--:--');
            return;
        }
        const tick = () => {
            const diff = new Date(nextScanAt).getTime() - Date.now();
            if (diff <= 0) {
                setDisplay('atualizando...');
                return;
            }
            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            setDisplay(`${mins}:${secs.toString().padStart(2, '0')}`);
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [nextScanAt]);

    return <span className="tabular-nums">{display}</span>;
};

// Ponto de frescor: verde < 2 min, amarelo < 10 min, cinza acima disso
const FreshnessDot: React.FC<{ lastScanAt: string | null }> = ({ lastScanAt }) => {
    const [color, setColor] = useState('bg-slate-600');

    useEffect(() => {
        const update = () => {
            if (!lastScanAt) { setColor('bg-slate-600'); return; }
            const diffMs = Date.now() - new Date(lastScanAt).getTime();
            if (diffMs < 2 * 60 * 1000) setColor('bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.7)]');
            else if (diffMs < 10 * 60 * 1000) setColor('bg-yellow-400');
            else setColor('bg-slate-600');
        };
        update();
        const id = setInterval(update, 10000);
        return () => clearInterval(id);
    }, [lastScanAt]);

    return <span className={`w-2 h-2 rounded-full ${color} shrink-0`} />;
};

const getUrgencyStyle = (level?: string) => {
    if (level === 'CRITICAL') return {
        border: 'border-red-500/40',
        dot: 'bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]',
        badge: 'bg-red-500/15 text-red-400 border-red-500/30',
        label: 'CRÍTICO'
    };
    if (level === 'HIGH') return {
        border: 'border-orange-500/30',
        dot: 'bg-orange-400',
        badge: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
        label: 'ALTO'
    };
    return {
        border: 'border-slate-700',
        dot: 'bg-yellow-400',
        badge: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
        label: 'MÉDIO'
    };
};

const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
};

// Cor do número do score (espelha getScoreColor em texto p/ destacar a nota).
const getScoreTextColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
};

const getRiskProfileBadge = (profile?: string) => {
    if (profile === 'DEFENSIVE') return <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 uppercase tracking-wide"><Shield size={9} /> Defensivo</span>;
    if (profile === 'MODERATE') return <span className="text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 uppercase tracking-wide"><Activity size={9} /> Moderado</span>;
    if (profile === 'BOLD') return <span className="text-[9px] font-bold text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 uppercase tracking-wide"><Zap size={9} /> Arrojado</span>;
    return null;
};

// Exibe o valor técnico principal do sinal (RSI ou desconto Graham)
const SignalValueBadge: React.FC<{ signalType?: string; value?: number }> = ({ signalType, value }) => {
    if (!value) return null;
    if (signalType === 'RSI_OVERSOLD' || signalType === 'BULLISH_DIVERGENCE') {
        return (
            <span className="text-[9px] font-bold tabular-nums whitespace-nowrap bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md">
                RSI {value.toFixed(0)}
            </span>
        );
    }
    if (signalType === 'DEEP_VALUE') {
        return (
            <span className="text-[9px] font-bold tabular-nums whitespace-nowrap bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md">
                Graham {(value * 100).toFixed(0) !== 'NaN' ? `R$${value.toFixed(2)}` : '-'}
            </span>
        );
    }
    return null;
};

// Mensagem do sinal com "lead" em negrito antes do primeiro ":" (ex.: "Deep Value:").
// Espelha o mock; se não houver rótulo curto, renderiza o texto puro.
const SignalMessage: React.FC<{ text?: string }> = ({ text }) => {
    const msg = text || '';
    const ci = msg.indexOf(':');
    if (ci > 0 && ci <= 28) {
        return <><strong className="text-white font-extrabold">{msg.slice(0, ci + 1)}</strong>{msg.slice(ci + 1)}</>;
    }
    return <>{msg}</>;
};

export const AiRadar: React.FC<AiRadarProps> = ({ signals, isLoading = false, meta, access }) => {
    const navigate = useNavigate();
    const [filter, setFilter] = useState<FilterType>('ALL');

    // Quem recebe sinal (tempo real ou defasado) vê a lista inteira; o backend já
    // decidiu o que entregar. Só 'NONE' cai na vitrine bloqueada.
    const tier = access?.tier ?? 'NONE';
    const hasAccess = tier !== 'NONE';
    const isDelayed = tier === 'DELAYED';

    const urgencyRank = (level?: string) => level === 'CRITICAL' ? 3 : level === 'HIGH' ? 2 : 1;

    const filteredSignals = useMemo(() => {
        if (!hasAccess) return signals.slice(0, 3);
        return signals
            .filter(s => filter === 'ALL' || s.assetType === filter)
            .sort((a, b) => {
                const rankDiff = urgencyRank(b.urgencyLevel) - urgencyRank(a.urgencyLevel);
                if (rankDiff !== 0) return rankDiff;
                return (b.score || 0) - (a.score || 0);
            });
    }, [signals, filter, hasAccess]);

    const isEmpty = filteredSignals.length === 0;

    const lastScanMinutesAgo = useMemo(() => {
        if (!meta?.lastScanAt) return null;
        const diff = Math.floor((Date.now() - new Date(meta.lastScanAt).getTime()) / 60000);
        if (diff === 0) return 'agora';
        return `há ${diff} min`;
    }, [meta?.lastScanAt]);

    const handleSignalClick = (ticker: string) => {
        if (!hasAccess) return;
        navigate('/research', { state: { openTicker: ticker } });
    };

    if (isLoading) {
        return (
            <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[480px]">
                <div className="p-4 border-b border-slate-800 bg-card">
                    <h3 className="flex items-center gap-2.5 text-sm font-bold text-white">
                        <span className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                            <Radar size={16} className="animate-spin-slow" />
                        </span>
                        Radar Alfa
                    </h3>
                </div>
                <div className="flex-1 p-3 space-y-3 bg-gradient-to-b from-base to-deep">
                    {[...Array(3)].map((_, i) => <div key={i} className="p-4 rounded-xl border border-slate-800 bg-panel animate-pulse h-24" />)}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-base border border-slate-800 rounded-2xl flex flex-col h-[480px] relative group hover:border-slate-700 transition-colors">

            {/* Header */}
            <div className="p-4 border-b border-slate-800 bg-card flex flex-col gap-2 rounded-t-2xl">

                {/* Linha 1: Título + Tooltip + Lock */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                            <Radar size={16} className="animate-spin-slow" />
                        </span>
                        <h3 className="text-sm font-bold text-white">Radar Alfa</h3>

                        <div className="group/tooltip relative flex items-center z-50">
                            <Info size={12} className="text-slate-600 cursor-help hover:text-blue-400 transition-colors" />
                            <div className="absolute left-0 top-6 w-64 p-4 bg-elevated border border-slate-700 rounded-xl shadow-2xl z-50 opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none text-left">
                                <p className="text-[10px] text-slate-300 leading-relaxed mb-2">
                                    Scanner quantitativo que detecta anomalias técnicas a cada <strong>15 minutos</strong>. Apenas sinais <strong className="text-gold">GOLD</strong>. Saída automática em +5% (alvo) ou -3% (stop).
                                </p>
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                        <span className="text-red-400 font-bold">CRÍTICO:</span>
                                        <span className="text-slate-400">RSI &lt; 20 ou Graham &gt; 45%</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px]">
                                        <span className="w-2 h-2 rounded-full bg-orange-400" />
                                        <span className="text-orange-400 font-bold">ALTO:</span>
                                        <span className="text-slate-400">RSI 20–30 ou Graham 30–45%</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {!hasAccess && (
                        <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700 flex items-center gap-1">
                            <Lock size={10} /> Pro
                        </span>
                    )}

                    {/* O ESSENTIAL recebe o sinal real, mas defasado — dizer isso é
                        obrigatório: sem o selo, um sinal de 1h atrás se passa por
                        tempo real e induz a uma decisão errada. */}
                    {isDelayed && (
                        <span
                            title={`Sinais com atraso de ${access?.delayMinutes} minutos. Tempo real a partir do plano Pro.`}
                            className="text-[9px] font-bold bg-yellow-500/10 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/20 flex items-center gap-1"
                        >
                            <Clock size={10} /> Atraso {access?.delayMinutes}min
                        </span>
                    )}
                </div>

                {/* Linha 2: Status de scan */}
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <FreshnessDot lastScanAt={meta?.lastScanAt || null} />
                        <span className="text-[11px] font-semibold text-slate-500 truncate">
                            {meta?.assetsScanned ? (
                                <><b className="text-slate-300 font-extrabold">{meta.assetsScanned}</b> ativos · última {lastScanMinutesAgo}</>
                            ) : 'aguardando varredura...'}
                        </span>
                    </div>
                    {meta?.nextScanAt && (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 whitespace-nowrap shrink-0">
                            <Clock size={11} className="text-slate-500" />
                            próx. <span className="text-purple-400 font-extrabold"><ScanCountdown nextScanAt={meta.nextScanAt} /></span>
                        </div>
                    )}
                </div>

                {/* Linha 3: Filtros (só PRO) — pílulas arredondadas; GOLD empurrado à direita */}
                {hasAccess && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        {([
                            ['ALL',      'TUDO', 'bg-slate-700 text-white'],
                            ['STOCK',    'BR',   'bg-blue-500/15 text-blue-400'],
                            ['FII',      'FII',  'bg-emerald-500/15 text-emerald-400'],
                            ['STOCK_US', 'EXT',  'bg-indigo-500/15 text-indigo-400'],
                        ] as [FilterType, string, string][]).map(([type, label, activeClass]) => (
                            <button
                                key={type}
                                onClick={() => setFilter(type)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-bold transition-colors ${filter === type ? activeClass : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'}`}
                            >
                                {label}
                            </button>
                        ))}
                        <span className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border bg-gold/10 text-gold border-gold/30">
                            <Medal size={9} /> GOLD
                        </span>
                    </div>
                )}
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar bg-gradient-to-b from-base to-deep relative rounded-b-2xl">

                {/* Paywall para não-PRO */}
                {!hasAccess && (
                    <div className="absolute inset-0 z-20 backdrop-blur-md bg-deep/60 flex flex-col items-center justify-center p-6 text-center rounded-b-2xl">
                        <div className="w-14 h-14 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/30 shadow-2xl shadow-blue-500/20">
                            <Crown size={24} className="text-blue-400" fill="currentColor" />
                        </div>
                        <h4 className="text-lg font-black text-white mb-2 uppercase tracking-tight">Scanner Quantitativo</h4>
                        <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-[220px]">
                            Monitoramento de anomalias matemáticas em tempo real exclusivo para assinantes <strong>Pro</strong>.
                        </p>
                        <button
                            onClick={() => navigate('/pricing')}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-wider rounded-xl transition-all shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-2"
                        >
                            <Zap size={14} fill="currentColor" /> Desbloquear Radar
                        </button>
                    </div>
                )}

                {/* Cards de sinais */}
                {(hasAccess ? filteredSignals : signals.slice(0, 3)).map((signal, idx) => {
                    const urgency = getUrgencyStyle(signal.urgencyLevel);
                    const score = Math.round(signal.score || 0);

                    return (
                        <div
                            key={signal.id || idx}
                            onClick={() => handleSignalClick(signal.ticker)}
                            className={`p-3.5 rounded-[14px] border transition-all relative overflow-hidden bg-panel ${urgency.border} ${hasAccess ? 'cursor-pointer hover:brightness-110 hover:-translate-y-0.5 hover:border-slate-600' : 'opacity-50 pointer-events-none grayscale'}`}
                        >
                            {/* Linha superior: ticker + badges */}
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex items-start gap-2.5 min-w-0">
                                    <AssetLogo ticker={signal.ticker} type={signal.assetType as AssetType} size={32} className="mt-0.5" />
                                    <div className="flex flex-col gap-1.5 min-w-0">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {/* Dot de urgência */}
                                        <span className={`w-1.5 h-1.5 rounded-full ${urgency.dot} shrink-0`} />
                                        <span className="font-black text-sm text-white tracking-wide">{signal.ticker}</span>
                                        <span className="text-[9px] font-bold bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-[5px] uppercase tracking-wide">
                                            {getTypeLabel(signal.assetType)}
                                        </span>
                                        {/* Urgência + Ouro agrupados: quebram juntos p/ o CRÍTICO ficar
                                            sempre colado à esquerda do OURO na coluna estreita */}
                                        <span className="flex items-center gap-1.5 shrink-0">
                                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-[5px] uppercase tracking-wide whitespace-nowrap ${urgency.badge}`}>
                                                {urgency.label}
                                            </span>
                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-[5px] uppercase tracking-wide whitespace-nowrap flex items-center gap-0.5 bg-gold/10 text-gold">
                                                <Medal size={9} /> Ouro
                                            </span>
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {getRiskProfileBadge(signal.riskProfile)}
                                        <SignalValueBadge signalType={signal.signalType} value={signal.value} />
                                    </div>
                                    </div>
                                </div>

                                {/* Score — nota em destaque + barra de qualidade abaixo */}
                                <div className="flex flex-col items-end shrink-0">
                                    <span className={`text-lg font-black leading-none ${getScoreTextColor(score)}`}>{score}</span>
                                    <div className="w-9 h-1 bg-slate-800 rounded-full overflow-hidden mt-1.5">
                                        <div className={`h-full ${getScoreColor(score)}`} style={{ width: `${score}%` }} />
                                    </div>
                                </div>
                            </div>

                            {/* Mensagem */}
                            <p className="text-[11px] leading-relaxed font-medium text-slate-400 border-t border-slate-800/50 pt-2">
                                {hasAccess ? <SignalMessage text={signal.message} /> : 'Sinal quantitativo oculto.'}
                            </p>

                            {/* Footer da card */}
                            <div className="flex items-center justify-between mt-2.5">
                                <span className="text-[9px] font-black tracking-wide px-2 py-1 rounded-md flex items-center gap-1 bg-emerald-500/10 text-emerald-400">
                                    <TrendingUp size={10} /> OPORTUNIDADE
                                </span>
                                <span className="text-[10px] font-semibold text-slate-500">{signal.time}</span>
                            </div>
                        </div>
                    );
                })}

                {/* Estado vazio — puramente quantitativo, sem fallback */}
                {hasAccess && isEmpty && (
                    <div className="h-full flex flex-col items-center justify-center text-center py-10">
                        <Radar size={36} className="text-slate-700 mb-3" />
                        <p className="text-xs font-bold text-slate-500">
                            Nenhuma anomalia GOLD detectada no momento.
                        </p>
                        {meta?.nextScanAt && (
                            <p className="text-[10px] text-slate-600 mt-1.5 flex items-center gap-1">
                                <Clock size={9} /> Próxima varredura em <ScanCountdown nextScanAt={meta.nextScanAt} />
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            {hasAccess && (
                <div className="p-3 border-t border-slate-800 bg-card rounded-b-2xl">
                    <button
                        onClick={() => navigate('/radar')}
                        className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-bold text-slate-400 hover:text-white uppercase tracking-wider transition-colors hover:bg-slate-800 rounded-lg"
                    >
                        <History size={12} /> Histórico & Performance
                    </button>
                </div>
            )}
        </div>
    );
};
