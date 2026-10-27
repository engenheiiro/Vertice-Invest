import React, { useState, useEffect } from 'react';

// Status da varredura de sinais, usado no card do Dashboard (AiRadar) e na
// página do Radar. Antes cada tela tinha uma cópia; só o acabamento visual
// variava, e é o que `className` carrega aqui.

// Countdown para a próxima varredura — decrementa localmente a cada segundo
export const ScanCountdown: React.FC<{ nextScanAt: string | null; className?: string }> = ({ nextScanAt, className = 'tabular-nums' }) => {
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

    return <span className={className}>{display}</span>;
};

// Ponto de frescor: verde < 2 min, amarelo < 10 min, cinza acima disso
export const FreshnessDot: React.FC<{ lastScanAt: string | null; sizeClassName?: string }> = ({ lastScanAt, sizeClassName = 'w-2 h-2' }) => {
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

    return <span className={`${sizeClassName} rounded-full ${color} shrink-0`} />;
};
