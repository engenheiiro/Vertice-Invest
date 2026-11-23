import React from 'react';
import { Target, Calculator } from 'lucide-react';
import { ETF_ORIGIN_LABELS, EXTERIOR_VIEWS, RISK_LABELS, type EtfOriginFilter, type RiskFilter } from './topPicksView';

const IDLE_CHIP = 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 hover:bg-slate-800';
const chipClass = (active: boolean, activeClass: string) => (active ? activeClass : IDLE_CHIP);

interface TopPicksFilterBarProps {
    riskFilter: RiskFilter;
    onRiskFilter: (filter: RiskFilter) => void;
    isBrasil10: boolean;
    /** Chips Ações/REITs: só no Exterior, e só quando o pai sabe trocar de ranking. */
    onExteriorViewChange?: (view: 'STOCK' | 'REIT') => void;
    exteriorActive: 'STOCK' | 'REIT' | null;
    /** Origem do ETF visível; `null` fora da aba ETFs. */
    etfOrigin: EtfOriginFilter | null;
    onEtfOrigin: (origin: EtfOriginFilter) => void;
    /** Aporte só aparece quando há COMPRAR no universo visível. */
    onAporte?: () => void;
}

const RiskChips = ({ riskFilter, onRiskFilter, isBrasil10 }: Pick<TopPicksFilterBarProps, 'riskFilter' | 'onRiskFilter' | 'isBrasil10'>) => (
    <>
        {Object.entries(RISK_LABELS).map(([key, label]) => {
            if (isBrasil10 && key !== 'DEFENSIVE') return null;
            return (
                <button
                    key={key}
                    onClick={() => onRiskFilter(key as RiskFilter)}
                    disabled={isBrasil10}
                    className={`whitespace-nowrap px-4 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${chipClass(riskFilter === key, 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20')} ${isBrasil10 ? 'cursor-default' : 'cursor-pointer'}`}
                >
                    {label}
                </button>
            );
        })}
    </>
);

const ExteriorChips = ({ active, onChange }: { active: 'STOCK' | 'REIT'; onChange: (view: 'STOCK' | 'REIT') => void }) => (
    <div className="flex items-center gap-1.5 pl-2 border-l border-slate-700/60 shrink-0">
        {EXTERIOR_VIEWS.map(({ key, label }) => (
            <button
                key={key}
                onClick={() => onChange(key)}
                className={`whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${chipClass(active === key, 'bg-cyan-700 border-cyan-600 text-white shadow-lg shadow-cyan-900/20')}`}
                title={`Exterior: ${label}`}
            >
                {label}
            </button>
        ))}
    </div>
);

const EtfOriginChips = ({ origin, onChange }: { origin: EtfOriginFilter; onChange: (origin: EtfOriginFilter) => void }) => (
    <div className="flex items-center gap-1.5 pl-2 border-l border-slate-700/60 shrink-0">
        {(Object.keys(ETF_ORIGIN_LABELS) as EtfOriginFilter[]).map((key) => (
            <button
                key={key}
                onClick={() => onChange(key)}
                className={`whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 ${chipClass(origin === key, 'bg-teal-600 border-teal-500 text-white shadow-lg shadow-teal-900/20')}`}
                title={`Filtrar ETFs: ${ETF_ORIGIN_LABELS[key]}`}
            >
                {ETF_ORIGIN_LABELS[key]}
            </button>
        ))}
    </div>
);

/** Barra "Perfil da Carteira": perfil de risco, sub-filtros da aba e o atalho de Aporte. */
export const TopPicksFilterBar = ({
    riskFilter, onRiskFilter, isBrasil10, onExteriorViewChange, exteriorActive, etfOrigin, onEtfOrigin, onAporte,
}: TopPicksFilterBarProps) => (
    <div className="bg-base border border-slate-800 rounded-3xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                <Target size={20} className="text-slate-400" />
            </div>
            <div>
                <h3 className="text-sm font-bold text-white">Perfil da Carteira</h3>
                <p className="text-[10px] text-slate-500">Selecione o nível de risco para gerar o Top 10 específico.</p>
            </div>
        </div>
        {/* Mobile: quebra em linhas em vez de rolar na horizontal — com
            `no-scrollbar` não havia pista visual e o botão "Aporte" (CTA)
            ficava cortado fora da tela. */}
        <div className="flex items-center justify-center gap-2 flex-wrap w-full md:w-auto md:flex-nowrap md:justify-start md:overflow-x-auto no-scrollbar min-w-0">
            <RiskChips riskFilter={riskFilter} onRiskFilter={onRiskFilter} isBrasil10={isBrasil10} />
            {exteriorActive && onExteriorViewChange && <ExteriorChips active={exteriorActive} onChange={onExteriorViewChange} />}
            {etfOrigin && <EtfOriginChips origin={etfOrigin} onChange={onEtfOrigin} />}
            {onAporte && (
                <div className="flex items-center gap-2 pl-2 border-l border-slate-700/60 shrink-0">
                    <button
                        onClick={onAporte}
                        className="flex items-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-xl text-xs font-bold bg-blue-900/20 border border-blue-800/50 text-blue-400 hover:bg-blue-900/40 hover:text-blue-300 transition-all"
                        title="Aporte Inteligente: distribui um valor entre os ativos COMPRAR"
                    >
                        <Calculator size={13} /> Aporte
                    </button>
                </div>
            )}
        </div>
    </div>
);
