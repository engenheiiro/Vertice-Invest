import React from 'react';
import { Modal } from '../ui';
import { useWallet } from '../../contexts/WalletContext';
import { buildDayMovers, formatAnchorLabel } from '../../utils/dayMovers';
import {
    emptyMoversMessage, groupMoverRows, moneyFormatters, moverScale, positiveEquity, sinceAnchorText,
} from '../../utils/dayMoversView';
import { DayMoversFooter, DayMoversList, DayMoversSummary, PAD, SharedReasonBanner } from './DayMoversParts';

interface DayMoversModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * "O dia da sua carteira": de quais posições veio a Variação Hoje.
 *
 * O total no cabeçalho é o MESMO número do card que abriu este modal — vem de
 * `kpis.dayVariation`, e as linhas abaixo são as contribuições que o servidor
 * mediu contra o snapshot-âncora. Nenhuma soma acontece aqui: se a tela
 * recalculasse, ela viraria uma terceira versão da verdade sobre o dia, que é
 * exatamente o problema que a âncora do dia resolveu no servidor.
 *
 * A única soma da tela é o SUBTOTAL POR GRUPO, e ela é sobre as linhas que o
 * usuário está vendo — é o que torna o saldo auditável sem disputar autoridade
 * com o KPI.
 */
export const DayMoversModal: React.FC<DayMoversModalProps> = ({ isOpen, onClose }) => {
    const { assets, kpis, isPrivacyMode } = useWallet();
    const movers = React.useMemo(() => buildDayMovers(assets, kpis), [assets, kpis]);
    const groups = React.useMemo(() => groupMoverRows(movers.rows), [movers.rows]);
    const scale = React.useMemo(() => moverScale(movers.rows), [movers.rows]);

    const fmt = moneyFormatters(isPrivacyMode);
    const anchorLabel = formatAnchorLabel(movers.anchorDate);
    const unmeasuredCount = movers.flatCount + groups.unmeasuredCount;
    const hasFooter = movers.pendingTreasury.count > 0 || movers.dividends > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            // 700px é medida do protótipo e não existe na escala do Tailwind
            // (2xl=672, 3xl=768). Arredondar para 3xl engordava 78px a coluna do
            // ativo — toda a folga sobrava do lado que menos precisa dela.
            maxWidth="max-w-[700px]"
            title={
                <span className="block">
                    <span className="block">O dia da sua carteira</span>
                    <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                        {sinceAnchorText(anchorLabel)}
                    </span>
                </span>
            }
        >
            {/* Resumo e rodapé ficam FORA da rolagem: as ressalvas do dia moravam no
                fim da lista, onde ninguém chega. Só a lista rola. */}
            <div className="flex max-h-[78vh] flex-col sm:max-h-[72vh]">
                <DayMoversSummary
                    movers={movers}
                    fmt={fmt}
                    equity={positiveEquity(kpis)}
                    assetCount={assets.length}
                    unmeasuredCount={unmeasuredCount}
                />

                {movers.sharedReason && <SharedReasonBanner movers={movers} anchorLabel={anchorLabel} />}

                {movers.rows.length === 0 ? (
                    <p className={`${PAD} pb-6 text-sm text-slate-400`}>
                        {emptyMoversMessage(movers, anchorLabel)}
                    </p>
                ) : (
                    <DayMoversList movers={movers} groups={groups.list} scale={scale} fmt={fmt} />
                )}

                {hasFooter && <DayMoversFooter movers={movers} money={fmt.money} />}
            </div>
        </Modal>
    );
};
