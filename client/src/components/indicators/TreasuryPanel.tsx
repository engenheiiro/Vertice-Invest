import { ShieldCheck, Database, ArrowUpDown, ChevronUp, ChevronDown, Filter, Clock } from 'lucide-react';
import {
    TREASURY_FILTERS, fmtBondPrice, fmtBondRate, fmtLastUpdated, getBondTypeStyle,
    type FilterType, type SortConfig, type SortKey, type TreasuryBond,
} from '../../pages/indicatorsView';

interface SortableHeaderProps {
    label: string;
    sortKey: SortKey;
    currentSort: SortConfig;
    onSort: (key: SortKey) => void;
    align: 'left' | 'right';
}

const SortableHeader = ({ label, sortKey, currentSort, onSort, align }: SortableHeaderProps) => (
    <th
        scope="col"
        className={`px-6 py-4 cursor-pointer hover:text-white transition-colors text-${align} bg-panel`}
        onClick={() => onSort(sortKey)}
    >
        <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : 'justify-start'}`}>
            {label}
            <ArrowUpDown size={10} className={currentSort.key === sortKey ? 'text-blue-500' : 'text-slate-700'} />
        </div>
    </th>
);

const COLUMNS: { label: string; sortKey: SortKey; align: 'left' | 'right' }[] = [
    { label: 'Título Público', sortKey: 'title', align: 'left' },
    { label: 'Tipo', sortKey: 'type', align: 'left' },
    { label: 'Rentabilidade Anual', sortKey: 'rate', align: 'right' },
    // PU e mínimo são coisas distintas por duas ordens de grandeza (R$ 3.002,69
    // contra R$ 30,03): mostrar só um dos dois com o rótulo do outro foi o que
    // confundiu a leitura da carteira.
    { label: 'Preço Unitário', sortKey: 'unitPrice', align: 'right' },
    { label: 'Investimento Mín.', sortKey: 'minInvestment', align: 'right' },
    { label: 'Vencimento', sortKey: 'maturityDate', align: 'right' },
];

const BondRow = ({ bond }: { bond: TreasuryBond }) => (
    <tr className="hover:bg-slate-900/40 transition-colors group">
        <td className="px-6 py-4 font-bold text-slate-200 group-hover:text-white">
            {bond.title}
        </td>
        <td className="px-6 py-4">
            <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${getBondTypeStyle(bond.type)}`}>
                {bond.type}
            </span>
        </td>
        <td className="px-6 py-4 text-right font-mono font-bold text-emerald-400">
            {fmtBondRate(bond)}
        </td>
        <td className="px-6 py-4 text-right text-slate-300 font-mono">
            {fmtBondPrice(bond.unitPrice)}
        </td>
        <td className="px-6 py-4 text-right text-slate-400">
            {fmtBondPrice(bond.minInvestment)}
        </td>
        <td className="px-6 py-4 text-right text-slate-400 font-medium">
            {bond.maturityDate}
        </td>
    </tr>
);

const EmptyRow = () => (
    <tr>
        <td colSpan={6} className="p-12 text-center text-slate-500 flex flex-col items-center justify-center">
            <Database size={32} className="mb-2 opacity-50" />
            <p className="font-bold">Base de dados sincronizando...</p>
        </td>
    </tr>
);

interface TreasuryTableProps {
    bonds: TreasuryBond[];
    sortConfig: SortConfig;
    onSort: (key: SortKey) => void;
}

const TreasuryTable = ({ bonds, sortConfig, onSort }: TreasuryTableProps) => (
    <div id="treasury-table" className="overflow-x-auto relative z-10 animate-fade-in">
        <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-panel text-[10px] font-black text-slate-500 uppercase tracking-widest sticky top-0 z-30 shadow-sm">
                <tr>
                    {COLUMNS.map((col) => (
                        <SortableHeader key={col.sortKey} {...col} currentSort={sortConfig} onSort={onSort} />
                    ))}
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-sm">
                {bonds.length > 0 ? bonds.map((bond) => <BondRow key={bond._id} bond={bond} />) : <EmptyRow />}
            </tbody>
        </table>
    </div>
);

const TreasuryFilters = ({ filterType, onFilter }: { filterType: FilterType; onFilter: (ft: FilterType) => void }) => (
    <div className="hidden md:flex items-center gap-2 bg-slate-900/50 p-1 rounded-lg border border-slate-800 animate-fade-in">
        <Filter size={14} className="text-slate-500 ml-2" />
        {TREASURY_FILTERS.map((ft) => (
            <button
                key={ft}
                onClick={() => onFilter(ft)}
                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
                    filterType === ft
                    ? 'bg-blue-600 text-white shadow-lg'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
            >
                {ft === 'ALL' ? 'Todos' : ft}
            </button>
        ))}
    </div>
);

interface TreasuryPanelProps {
    bondCount: number;
    sortedBonds: TreasuryBond[];
    lastUpdated?: string;
    isOpen: boolean;
    onToggle: () => void;
    sortConfig: SortConfig;
    onSort: (key: SortKey) => void;
    filterType: FilterType;
    onFilter: (ft: FilterType) => void;
}

/**
 * Contêiner do Tesouro Direto: o título é o botão; os filtros ficam ao lado dele, não dentro (botão dentro de botão).
 * O estado mora na página: abrir o painel re-renderiza a página e lê o dado mais recente da query.
 */
export const TreasuryPanel = ({
    bondCount, sortedBonds, lastUpdated, isOpen, onToggle: toggle, sortConfig, onSort, filterType, onFilter,
}: TreasuryPanelProps) => (
    <div className="bg-base border border-slate-800 rounded-2xl overflow-hidden shadow-2xl relative z-0 mb-6">
        <div className="p-6 border-b border-slate-800 bg-card flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-panel transition-colors">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={isOpen}
                aria-controls="treasury-table"
                aria-labelledby="treasury-heading"
                className="flex items-center gap-3 text-left"
            >
                <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center border border-slate-800">
                    <ShieldCheck size={20} className="text-emerald-500" />
                </div>
                <div>
                    <h2 id="treasury-heading" className="text-lg font-bold text-white uppercase tracking-wide">Tesouro Direto</h2>
                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-1">
                        <Database size={10} /> Base Oficial: {bondCount} Títulos
                        {lastUpdated && (
                            <span className="ml-2 flex items-center gap-0.5 text-slate-600 normal-case font-medium">
                                <Clock size={9} /> {fmtLastUpdated(lastUpdated)}
                            </span>
                        )}
                    </p>
                </div>
            </button>

            <div className="flex items-center gap-4">
                {isOpen && <TreasuryFilters filterType={filterType} onFilter={onFilter} />}
                <button type="button" tabIndex={-1} aria-hidden="true" onClick={toggle}
                    className="p-2 bg-slate-800 rounded-lg text-slate-400">
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>
        </div>

        {isOpen && (
            <TreasuryTable bonds={sortedBonds} sortConfig={sortConfig} onSort={onSort} />
        )}
    </div>
);
