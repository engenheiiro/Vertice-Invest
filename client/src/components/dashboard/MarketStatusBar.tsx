
import React, { useEffect, useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Percent } from 'lucide-react';
import { MarketIndex } from '../../hooks/useDashboardData';

interface MarketStatusBarProps {
    indices: MarketIndex[];
}

/**
 * Pregão da B3 no fuso de SÃO PAULO, não no relógio da máquina de quem abre a
 * página: quem acessa de fora do Brasil via um horário deslocado e lia "Mercado
 * Fechado" no meio do pregão (e vice-versa).
 *
 * Não considera feriado — a lista vive no servidor e a barra não vale uma ida à
 * rede. Em feriado o rótulo erra por algumas horas; o resto do painel já mostra a
 * ausência de negócio.
 */
const readB3Session = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        weekday: 'short',
        hour: 'numeric',
        hour12: false,
    }).formatToParts(new Date());

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);

    const isWeekday = !['Sat', 'Sun'].includes(weekday);
    const isOpenHours = hour >= 10 && hour < 18;

    return isWeekday && isOpenHours;
};

export const MarketStatusBar: React.FC<MarketStatusBarProps> = ({ indices }) => {

    // Sem o tique, `useMemo(..., [])` calculava o estado UMA vez na montagem: uma
    // aba deixada aberta seguia anunciando "Mercado Aberto" às 22h.
    const [isOpen, setIsOpen] = useState(readB3Session);

    useEffect(() => {
        const id = window.setInterval(() => setIsOpen(readB3Session()), 60000);
        return () => window.clearInterval(id);
    }, []);

    const marketStatus = useMemo(() => (
        isOpen
            ? { label: 'Mercado Aberto', color: 'text-emerald-500', dot: 'bg-emerald-500 animate-pulse' }
            : { label: 'Mercado Fechado', color: 'text-slate-500', dot: 'bg-slate-600' }
    ), [isOpen]);

    return (
        <div className="w-full app-ticker border-b border-slate-800/60 py-2 overflow-hidden">
            <div className="max-w-[1360px] mx-auto px-6 flex items-center gap-5 overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-2 pr-4 border-r border-slate-800/60 shrink-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${marketStatus.dot}`}></span>
                    <span className={`text-[10px] font-bold uppercase tracking-widest ${marketStatus.color}`}>
                        {marketStatus.label}
                    </span>
                </div>

                {indices.map((idx) => {
                    const change = idx.changePercent || 0;
                    const val = idx.value;
                    const isRate = idx.type === 'RATE'; // CDI, SELIC
                    const isMissing = val === null || !Number.isFinite(val);

                    let Icon = Minus;
                    let colorClass = 'text-slate-400';
                    let chipClass = 'bg-slate-800/60 text-slate-400';

                    if (change > 0) {
                        Icon = TrendingUp;
                        colorClass = 'text-emerald-500';
                        chipClass = 'bg-emerald-500/10 text-emerald-500';
                    } else if (change < 0) {
                        Icon = TrendingDown;
                        colorClass = 'text-red-500';
                        chipClass = 'bg-red-500/10 text-red-500';
                    } else if (isRate) {
                        colorClass = 'text-slate-300';
                        Icon = Percent;
                    }

                    // Ausente vira travessão. Exibir "0,00" no lugar de um valor que
                    // o servidor não tem é indistinguível de uma cotação real de zero.
                    const displayValue = isMissing
                        ? '—'
                        : `${idx.prefix ?? ''}${(val as number) < 100
                            ? (val as number).toFixed(2)
                            : (val as number).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;

                    // Valor preservado de um sync anterior: o número é real, mas não é
                    // o de agora. Some a cor da variação (ela responde a outro dia) e
                    // o rótulo diz o porquê em vez de deixar o usuário deduzir.
                    const isStale = !isMissing && !!idx.stale;
                    const staleTitle = 'Cotação defasada: a fonte de câmbio não respondeu na última sincronização e este é o último valor conhecido.';

                    return (
                        <div
                            key={idx.ticker}
                            className="flex items-center gap-2 shrink-0 group cursor-default"
                            title={isStale ? staleTitle : undefined}
                        >
                            <span className="text-[10px] font-bold text-slate-400 font-mono tracking-wide group-hover:text-blue-400 transition-colors">{idx.ticker}</span>
                            <div className={`flex items-center gap-1.5 text-[11px] font-mono font-semibold tabular-nums ${isStale || isMissing ? 'text-slate-500' : colorClass}`}>
                                {!isRate && !isMissing && !isStale && <Icon size={11} />}
                                <span className={isStale || isMissing ? 'text-slate-500' : 'text-slate-200'}>{displayValue}</span>

                                {isMissing ? null : isRate ? (
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wide">a.a.</span>
                                ) : isStale ? (
                                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800/60 text-slate-500">
                                        defasado
                                    </span>
                                ) : (
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${chipClass}`}>
                                        {change > 0 ? '+' : ''}{change.toFixed(2)}%
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
