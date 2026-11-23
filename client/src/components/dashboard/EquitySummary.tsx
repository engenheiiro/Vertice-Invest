
import React from 'react';
import { useWallet } from '../../contexts/WalletContext';
import { TrendingUp, DollarSign, PiggyBank, ArrowUpRight, ArrowDownRight, Activity, Layers, ShieldCheck, AlertTriangle, Scale } from 'lucide-react';
import { SkeletonKpiGrid } from '../ui';
import { formatCurrency as fmtCurrency } from '../../utils/format';
import { useCountUp } from '../../hooks/useCountUp';
import { DayMoversModal } from '../wallet/DayMoversModal';
import { EquityHeroCard } from './EquityHeroCard';
import { EquityStatCard } from './EquityStatCard';
import { buildEquitySummaryView, fixedOrMask, plusSign, type EquitySummaryView } from './equitySummaryView';

interface EquitySummaryProps {
    onGenerateReport?: () => void;
}

const RentabilityValue = ({ view, text }: { view: EquitySummaryView; text: string }) => (
    <span className={`inline-flex items-center gap-1 ${view.rentabilityClass}`}>
        {view.isRentabilityPositive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
        {text}%
    </span>
);

/** Selo de risco (Sharpe, quando medido) + selo de qualidade do dado. */
const ResultTag = ({ view }: { view: EquitySummaryView }) => (
    <>
        {view.sharpeLabel && (
            <span className="inline-flex items-center gap-1 mr-1 text-slate-400" title={view.sharpeTitle}>
                <Scale size={10} /> {view.sharpeLabel}
            </span>
        )}
        {view.isAudited ? <ShieldCheck size={11} /> : <AlertTriangle size={11} />}
        {view.isAudited ? 'Auditado' : 'Estimado'}
    </>
);

/**
 * KPIs patrimoniais do Terminal. Compartilha a MESMA linguagem visual do
 * `WalletSummary` da aba Carteira (card-herói verde + StatCard com ícone em
 * quadrado tingido + pílulas arredondadas), variando apenas o grid (aqui a
 * coluna é mais estreita: 2 col no md, 4 no xl). Valores usam <FitText> para
 * nunca cortar dígitos em patrimônios grandes. As decisões moram em
 * `equitySummaryView.ts`; aqui só se monta a tela.
 */
export const EquitySummary: React.FC<EquitySummaryProps> = () => {
    const { kpis, isPrivacyMode, isLoading, isReadOnly } = useWallet();
    const animatedEquity = useCountUp(kpis?.totalEquity || 0);
    // Hooks primeiro: o guard de `isLoading` abaixo retorna cedo.
    const [isDayModalOpen, setIsDayModalOpen] = React.useState(false);

    if (isLoading) {
        return <SkeletonKpiGrid count={4} />;
    }

    const view = buildEquitySummaryView(kpis);
    const money = (val: number | null | undefined) => fmtCurrency(val, 'BRL', { privacy: isPrivacyMode });
    const fixed = (val: number | null | undefined) => fixedOrMask(val, isPrivacyMode);

    return (
        // No celular, cada KPI ocupa a largura inteira — o mesmo comportamento da Carteira.
        <section aria-label="Resumo patrimonial" className="grid auto-rows-fr grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">

            {/* 1. PATRIMÔNIO LÍQUIDO — card "herói" em gradiente verde (destaque). */}
            <EquityHeroCard
                view={view}
                equityText={money(animatedEquity)}
                dayVariationText={money(kpis.dayVariation)}
                dayPercentText={fixed(kpis.dayVariationPercent)}
                capitalPercentText={fixed(view.capitalVariationPercent)}
                isReadOnly={isReadOnly}
                onOpenDay={() => setIsDayModalOpen(true)}
            />

            {/* 2. VALOR APLICADO */}
            <EquityStatCard
                label="Valor Aplicado"
                tooltipText="Custo Contábil: soma exata do dinheiro que saiu do seu bolso. Não inclui dividendos reinvestidos (estes aumentam apenas a quantidade de cotas)."
                icon={<DollarSign size={16} />}
                iconClass="bg-slate-800 text-slate-300"
                value={money(kpis.totalInvested)}
                subLabel="Patrimônio + Proventos"
                subValue={money(view.totalGross)}
                tag={<><Activity size={11} /> {view.grossMultiple.toFixed(2)}x</>}
                tagClass="bg-purple-500/10 text-purple-400 border-purple-500/20"
            />

            {/* 3. LUCRO TOTAL */}
            <EquityStatCard
                label="Lucro Total"
                tooltipText="Resultado total = ganho de capital (valorização dos ativos) + proventos recebidos. O card 'Prov. Acumulados' detalha apenas a parcela de proventos."
                icon={<TrendingUp size={16} />}
                iconClass={view.totalIconClass}
                value={`${plusSign(view.isTotalPositive)}${money(kpis.totalResult)}`}
                valueClass={view.totalValueClass}
                subLabel="Rentabilidade Real (TWRR)"
                subValue={<RentabilityValue view={view} text={fixed(kpis.weightedRentability)} />}
                tag={<ResultTag view={view} />}
                tagClass={view.qualityTagClass}
            />

            {/* 4. PROVENTOS */}
            <EquityStatCard
                label="Prov. Acumulados"
                tooltipText="Tudo que seus ativos já anunciaram, incluindo o que ainda vai cair na conta (detalhe na aba Proventos). A Média Mensal Est. é quanto isso rende por mês."
                icon={<PiggyBank size={16} />}
                iconClass="bg-gold/10 text-gold"
                value={money(kpis.totalDividends)}
                subLabel="Média Mensal Est."
                subValue={<span className="text-gold">{money(kpis.projectedDividends)}</span>}
                tag={<><Layers size={11} /> Passivo</>}
                tagClass="bg-gold/10 text-gold border-gold/20"
            />

            <DayMoversModal isOpen={isDayModalOpen} onClose={() => setIsDayModalOpen(false)} />
        </section>
    );
};
