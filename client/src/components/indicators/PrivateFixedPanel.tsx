import React from 'react';
import { Database, ChevronUp, ChevronDown, Landmark } from 'lucide-react';
import { fmtCurrency } from '../../pages/indicatorsView';

// LISTA ATUALIZADA - DAY AFTER
const POPULAR_CDB_LCI = [
    { _id: 'sofisa', title: 'Sofisa Direto', type: 'CDB', rate: 110, index: 'CDI', minInvestment: 1.00, issuer: 'Sofisa', maturity: 'Imediata' },
    { _id: 'nu_reserva', title: 'Nubank (Caixinha Reserva)', type: 'RDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Nubank', maturity: 'Imediata' },
    { _id: 'nu_turbo', title: 'Nubank (Caixinha Turbo)', type: 'RDB', rate: 115, index: 'CDI', minInvestment: 1.00, issuer: 'Nubank', maturity: 'Imediata (Max 5k)' },
    { _id: 'inter', title: 'Banco Inter (Meu Porquinho)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Banco Inter', maturity: 'Imediata' },
    { _id: 'mp', title: 'Mercado Pago (Conta)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Mercado Pago', maturity: 'Imediata' },
    { _id: 'picpay', title: 'PicPay (Cofrinhos)', type: 'CDB', rate: 102, index: 'CDI', minInvestment: 1.00, issuer: 'PicPay', maturity: 'Imediata' },
    { _id: 'pagbank', title: 'PagBank (Conta Rendeira)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'PagBank', maturity: 'Imediata' },
    { _id: 'itau', title: 'Itaú (Iti)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 1.00, issuer: 'Itaú', maturity: 'Imediata' },
    { _id: '99pay', title: '99Pay (Lucrativa)', type: 'CDB', rate: 110, index: 'CDI', minInvestment: 1.00, issuer: '99Pay', maturity: 'Imediata (Limitada)' },
    { _id: 'c6', title: 'C6 Bank (CDB Cartão)', type: 'CDB', rate: 100, index: 'CDI', minInvestment: 100.00, issuer: 'C6 Bank', maturity: 'Imediata' }
];

/** Teclado no cabeçalho recolhível (que tem botões dentro e por isso não vira <button>). */
const onToggleKey = (toggle: () => void) => (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
};

const PrivateFixedTable = () => (
    <div className="overflow-x-auto relative z-10 animate-fade-in">
        <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-panel text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-30 shadow-sm">
                <tr>
                    <th scope="col" className="px-6 py-4">Produto</th>
                    <th scope="col" className="px-6 py-4">Emissor</th>
                    <th scope="col" className="px-6 py-4 text-right">Rentabilidade</th>
                    <th scope="col" className="px-6 py-4 text-right">Mínimo</th>
                    <th scope="col" className="px-6 py-4 text-right">Vencimento / Liquidez</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-sm">
                {POPULAR_CDB_LCI.map((item) => (
                    <tr key={item._id} className="hover:bg-slate-900/40 transition-colors group">
                        <td className="px-6 py-4 font-bold text-slate-200 group-hover:text-white">
                            {item.title}
                        </td>
                        <td className="px-6 py-4 text-slate-400">
                            {item.issuer}
                        </td>
                        <td className="px-6 py-4 text-right font-mono font-bold text-blue-400">
                            {item.rate}% do {item.index}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-300">
                            {fmtCurrency(item.minInvestment)}
                        </td>
                        <td className="px-6 py-4 text-right text-slate-400 font-medium">
                            {item.maturity}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

/** Contêiner dos CDBs, caixinhas e cofrinhos (lista curada à mão). O estado mora na página. */
export const PrivateFixedPanel = ({ isOpen, onToggle: toggle }: { isOpen: boolean; onToggle: () => void }) => {
    return (
        <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative z-0">
            <div
                className="p-6 border-b border-slate-800 bg-card flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-panel transition-colors"
                onClick={toggle}
                onKeyDown={onToggleKey(toggle)}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                aria-labelledby="private-fixed-heading"
            >
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                        <Landmark size={20} className="text-blue-500" />
                    </div>
                    <div>
                        <h2 id="private-fixed-heading" className="text-lg font-bold text-white uppercase tracking-wide">CDBs, Caixinhas & Cofrinhos</h2>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
                            <Database size={10} /> Bancos Digitais & Corretoras · <span className="text-slate-600 font-medium normal-case">Dados Curados</span>
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="p-2 bg-slate-800 rounded-lg text-slate-400">
                        {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                </div>
            </div>

            {isOpen && <PrivateFixedTable />}
        </div>
    );
};
