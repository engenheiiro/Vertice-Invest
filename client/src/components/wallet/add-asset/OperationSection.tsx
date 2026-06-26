import React from 'react';
import { ArrowUpCircle, ArrowDownCircle, Tag } from 'lucide-react';
import { Input } from '../../ui/Input';
import type { AssetType } from '../../../contexts/WalletContext';
import type { TransactionType } from './types';

interface OperationSectionProps {
    transactionType: TransactionType;
    onSelectTransactionType: (type: TransactionType) => void;
    assetType: AssetType;
    onTypeChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    date: string;
    maxDate: string;
    onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Seção "Operação": define O QUE o usuário quer fazer.
 * Operação (comprar/aportar vs. vender/resgatar), tipo de ativo e data.
 */
export const OperationSection: React.FC<OperationSectionProps> = ({
    transactionType,
    onSelectTransactionType,
    assetType,
    onTypeChange,
    date,
    maxDate,
    onDateChange,
}) => (
    <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 p-1 bg-panel rounded-xl border border-slate-800">
            <button
                type="button"
                onClick={() => onSelectTransactionType('BUY')}
                className={`flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-lg min-h-[44px] ${
                    transactionType === 'BUY'
                        ? 'bg-emerald-600 text-white shadow-lg'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
            >
                <ArrowUpCircle size={14} /> Comprar / Aportar
            </button>
            <button
                type="button"
                onClick={() => onSelectTransactionType('SELL')}
                className={`flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-wider transition-all rounded-lg min-h-[44px] ${
                    transactionType === 'SELL'
                        ? 'bg-red-600 text-white shadow-lg'
                        : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
                }`}
            >
                <ArrowDownCircle size={14} /> Vender / Resgatar
            </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
                <label className="text-[10px] font-bold uppercase text-slate-500 ml-1 mb-1.5 block">Tipo de Ativo</label>
                <div className="relative">
                    <select
                        value={assetType}
                        onChange={onTypeChange}
                        className="w-full bg-card text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer hover:border-slate-700 hover:bg-elevated transition-all duration-300 shadow-sm"
                    >
                        <option value="STOCK">Ações Brasil (B3)</option>
                        <option value="FII">Fundos Imobiliários (FIIs)</option>
                        <option value="STOCK_US">Ações Exterior (USD)</option>
                        <option value="ETF">ETFs (Nacionais / Internacionais)</option>
                        <option value="CRYPTO">Criptomoedas</option>
                        <option value="FIXED_INCOME">Renda Fixa / Tesouro Direto</option>
                        <option value="CASH">Reserva / Caixa</option>
                    </select>
                    <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                </div>
            </div>
            <Input
                label="Data do Aporte"
                type="date"
                value={date}
                max={maxDate}
                onChange={onDateChange}
                containerClassName="mb-0 col-span-1"
            />
        </div>
    </div>
);
