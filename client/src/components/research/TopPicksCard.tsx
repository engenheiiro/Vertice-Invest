import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Layers } from 'lucide-react';
import { RankingItem } from '../../services/research';
import { AssetDetailModal } from './AssetDetailModal';
import { useWallet } from '../../contexts/WalletContext';
import { formatCompact as fmtCompact } from '../../utils/format';
import { filterPicks, hasBuyInScope, pickPosition, type EtfOriginFilter, type RiskFilter } from './topPicksView';
import { TopPicksFilterBar } from './TopPicksFilterBar';
import { TopPicksOverview } from './TopPicksOverview';
import { TopPickRow } from './TopPickRow';


interface TopPicksCardProps {
    picks: RankingItem[];
    assetClass: string;
    onAporte?: () => void;
    // Exterior: alterna entre os rankings independentes Ações (STOCK_US) e REITs.
    // Quando presente, os chips Ações/REITs aparecem na barra "Perfil da Carteira".
    onExteriorViewChange?: (view: 'STOCK' | 'REIT') => void;
    // Aba ETFs: notifica o pai (Research) da origem selecionada (Nacional/Internacional)
    // para que o modal de Aporte considere o mesmo universo. O estado segue interno aqui.
    onEtfOriginChange?: (origin: 'BR' | 'US') => void;
    // Origem inicial da aba ETFs. Só vale na montagem — serve ao deep link do Aporte
    // da Carteira (linha "ETFs" de Ações BR abre no Nacional, não no Internacional).
    initialEtfOrigin?: 'BR' | 'US';
}

export const TopPicksCard: React.FC<TopPicksCardProps> = ({ picks, assetClass, onAporte, onExteriorViewChange, onEtfOriginChange, initialEtfOrigin }) => {
    const { assets, kpis, isPrivacyMode } = useWallet();
    const [selectedAsset, setSelectedAsset] = useState<RankingItem | null>(null);
    const [riskFilter, setRiskFilter] = useState<RiskFilter>('DEFENSIVE');
    const [etfOrigin, setEtfOrigin] = useState<EtfOriginFilter>(initialEtfOrigin || 'US');

    const isBrasil10 = assetClass === 'BRASIL_10';
    // Exterior (STOCK_US) e REIT já vêm como rankings puros do backend; o chip
    // Ações/REITs ativo deriva da classe do ranking carregado.
    const isStockUS = assetClass === 'STOCK_US' || assetClass === 'REIT';
    const isEtf = assetClass === 'ETF';

    useEffect(() => {
        if (isBrasil10) {
            setRiskFilter('DEFENSIVE');
        }
    }, [assetClass, isBrasil10]);

    // Reseta o sub-filtro de origem (default Internacional) ao TROCAR de classe. Na
    // montagem o reset é pulado: senão ele apagaria a origem pedida pelo deep link
    // (initialEtfOrigin) antes mesmo do usuário ver a lista.
    const mountedRef = useRef(false);
    useEffect(() => {
        if (!mountedRef.current) { mountedRef.current = true; return; }
        setEtfOrigin('US');
    }, [assetClass]);

    // Mantém o pai (Research → modal de Aporte) em sincronia com a origem visível.
    useEffect(() => { onEtfOriginChange?.(etfOrigin); }, [etfOrigin, onEtfOriginChange]);

    const filteredPicks = useMemo(() => filterPicks(picks, riskFilter, isEtf, etfOrigin), [picks, riskFilter, isEtf, etfOrigin]);
    const showAporte = useMemo(() => hasBuyInScope(picks, isEtf, etfOrigin), [picks, isEtf, etfOrigin]);

    // A carteira IDEAL é composta apenas pelos COMPRAR: um AGUARDAR não faz parte da
    // alocação-alvo (Exposição Ideal e Meta % por ativo).
    const buyPicks = useMemo(() => filteredPicks.filter(p => p.action === 'BUY'), [filteredPicks]);

    const formatCurrency = (val: number) => {
        if (!val && val !== 0) return '-';
        return fmtCompact(val, 'BRL', { privacy: isPrivacyMode });
    };

    return (
        <div className="max-w-7xl mx-auto animate-fade-in space-y-6 pb-20">
            <TopPicksFilterBar
                riskFilter={riskFilter}
                onRiskFilter={setRiskFilter}
                isBrasil10={isBrasil10}
                onExteriorViewChange={onExteriorViewChange}
                exteriorActive={isStockUS ? (assetClass === 'REIT' ? 'REIT' : 'STOCK') : null}
                etfOrigin={isEtf ? etfOrigin : null}
                onEtfOrigin={setEtfOrigin}
                onAporte={showAporte ? onAporte : undefined}
            />

            <TopPicksOverview picks={filteredPicks} buyPicks={buyPicks} assetClass={assetClass} riskFilter={riskFilter} />

            {/* LISTA DETALHADA */}
            <div className="space-y-3">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Layers size={12} /> Composição Detalhada
                    </h3>
                </div>
                {filteredPicks.map((pick, idx) => (
                    <TopPickRow
                        key={idx}
                        pick={pick}
                        assetClass={assetClass}
                        position={pickPosition(pick, assets, kpis.totalEquity, buyPicks.length)}
                        formatCurrency={formatCurrency}
                        onSelect={setSelectedAsset}
                    />
                ))}
            </div>

            <AssetDetailModal isOpen={!!selectedAsset} onClose={() => setSelectedAsset(null)} asset={selectedAsset} />
        </div>
    );
};
