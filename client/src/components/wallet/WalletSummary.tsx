
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, ShieldCheck, AlertTriangle, Scale } from 'lucide-react';
import { SkeletonKpiGrid } from '../ui'; // (I12) skeleton padronizado
import { formatCurrency as fmtCurrency } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';
import { fixedOrMask, plusSign } from '../dashboard/equitySummaryView';
import { buildWalletSummaryView } from './walletSummaryView';
import { WalletHeroCard } from './WalletHeroCard';
import { StatCard } from './WalletStatCard';
import { DayMoversModal } from './DayMoversModal';

interface EquitySummaryProps {
    onGenerateReport?: () => void;
}

export const WalletSummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, togglePrivacyMode, isLoading, isValuesLocked, isReadOnly } = useWallet();
    const animatedEquity = useCountUp(kpis?.totalEquity || 0);
    // Hooks primeiro: o guard de `isLoading` abaixo retorna cedo, e declarar
    // estado depois dele quebraria a ordem entre renderizações.
    const [isDayModalOpen, setIsDayModalOpen] = React.useState(false);

    if (isLoading) {
        return <SkeletonKpiGrid count={4} className="mb-8" />;
    }

    const formatCurrency = (val: number | null | undefined) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });
    const fixed = (val: number | null | undefined) => fixedOrMask(val, isPrivacyMode);
    // Badge do Patrimônio Líquido = variação do CAPITAL (patrimônio vs. investido),
    // não o retorno total. O retorno total (com proventos) fica no card Lucro Total.
    const view = buildWalletSummaryView(kpis);

    return (
        // (A7) região nomeada para os indicadores patrimoniais (landmark)
        // No celular, cada KPI ocupa a largura inteira para preservar a leitura dos
        // valores. A partir do tablet, o resumo volta ao grid compacto.
        <section aria-label="Resumo patrimonial" className="grid auto-rows-fr grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">

            {/* 1. PATRIMÔNIO LÍQUIDO — card "herói" em gradiente verde (destaque da carteira) */}
            <WalletHeroCard
                view={view}
                equityText={formatCurrency(animatedEquity)}
                dayVariationText={formatCurrency(kpis.dayVariation)}
                dayPercentText={fixed(kpis.dayVariationPercent)}
                capitalPercentText={fixed(view.capitalVariationPercent)}
                isPrivacyMode={isPrivacyMode}
                onTogglePrivacy={togglePrivacyMode}
                isValuesLocked={isValuesLocked}
                isReadOnly={isReadOnly}
                onOpenDay={() => setIsDayModalOpen(true)}
            />

            {/* 2. VALOR APLICADO — o múltiplo bruto, com o aplicado, reconstituiria o
                patrimônio: no modo privacidade ele é mascarado como os valores. */}
            <StatCard
                label="Valor Aplicado"
                tooltipText="Total que saiu do seu bolso."
                icon={<DollarSign size={16} />}
                iconClass="bg-slate-800 text-slate-300"
                value={formatCurrency(kpis.totalInvested)}
                subLabel="Aplicado + Resultado"
                subValue={formatCurrency(view.totalGross)}
                tag={<><Activity size={11} /> {fixed(view.grossMultiple)}x</>}
                tagClass="bg-purple-500/10 text-purple-400 border-purple-500/20"
            />

            {/* 3. LUCRO TOTAL */}
            <StatCard
                label="Lucro Total"
                tooltipText="Valorização + proventos recebidos."
                icon={<TrendingUp size={16} />}
                iconClass={view.totalIconClass}
                value={`${plusSign(view.isTotalPositive)}${formatCurrency(kpis.totalResult)}`}
                valueClass={view.totalValueClass}
                subLabel="Rentabilidade Real (TWRR)"
                subValue={
                    <span className={`inline-flex items-center gap-1 ${view.rentabilityClass}`}>
                        {view.isRentabilityPositive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                        {fixed(kpis.weightedRentability)}%
                    </span>
                }
                tag={
                    <>
                        {view.sharpeLabel && (
                            <span className="inline-flex items-center gap-1 mr-1 text-slate-400" title={view.sharpeTitle}>
                                <Scale size={10} /> {view.sharpeLabel}
                            </span>
                        )}
                        {view.isAudited ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
                        {view.isAudited ? 'Auditado' : 'Estimado'}
                    </>
                }
                tagClass={view.qualityTagClass}
            />

            {/* 4. PROVENTOS */}
            <StatCard
                label="Prov. Acumulados"
                tooltipText="Proventos recebidos e a receber."
                icon={<PiggyBank size={16} />}
                iconClass="bg-gold/10 text-gold"
                value={formatCurrency(kpis.totalDividends)}
                subLabel="Média Mensal Est."
                subValue={<span className="text-gold">{formatCurrency(kpis.projectedDividends)}</span>}
                tag={<><Layers size={11} /> Passivo</>}
                tagClass="bg-gold/10 text-gold border-gold/20"
            />

            <DayMoversModal isOpen={isDayModalOpen} onClose={() => setIsDayModalOpen(false)} />
        </section>
    );
};
