import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, PlusCircle, DollarSign, BarChart2, Tag } from 'lucide-react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useWallet, AssetType } from '../../contexts/WalletContext';

interface AddAssetModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const AddAssetModal: React.FC<AddAssetModalProps> = ({ isOpen, onClose }) => {
    const { addAsset } = useWallet();
    const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

    const [form, setForm] = useState({
        ticker: '',
        name: '', 
        type: 'STOCK' as AssetType,
        quantity: '',
        price: '',
        date: new Date().toISOString().split('T')[0]
    });

    // Reset e Bloqueio de Scroll
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setStatus('idle');
        } else {
            document.body.style.overflow = 'unset';
            setForm({ ticker: '', name: '', type: 'STOCK', quantity: '', price: '', date: new Date().toISOString().split('T')[0] });
        }
        return () => { document.body.style.overflow = 'unset'; };
    }, [isOpen]);

    useEffect(() => {
        if (form.type === 'CASH') {
            setForm(prev => ({ ...prev, ticker: 'RESERVA', quantity: '', price: '1,00' }));
        } else if (form.type === 'CRYPTO') {
            setForm(prev => ({ ...prev, ticker: '', quantity: '', price: '' }));
        } else {
             setForm(prev => ({ ...prev, ticker: '', quantity: '', price: '' }));
        }
    }, [form.type]);

    if (!isOpen) return null;

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        if(val === '') { setForm({...form, price: ''}); return; }
        setForm({...form, price: val});
    };
    
    const handlePriceBlur = () => {
        if (!form.price) return;
        let val = form.price.replace(',', '.');
        let num = parseFloat(val);
        if (!isNaN(num)) {
            setForm(prev => ({...prev, price: num.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('loading');

        try {
            await new Promise(resolve => setTimeout(resolve, 800));

            let finalTicker = form.ticker.toUpperCase();
            let finalQty = Number(form.quantity.replace(',', '.'));
            let finalPrice = Number(form.price.replace(/\./g, '').replace(',', '.'));

            if (form.type === 'CASH') {
                finalQty = 1;
                finalPrice = Number(form.price.replace(/\./g, '').replace(',', '.'));
            }

            addAsset({
                ticker: finalTicker,
                name: form.name || finalTicker,
                type: form.type,
                quantity: finalQty,
                averagePrice: finalPrice,
                currency: form.type === 'STOCK_US' ? 'USD' : 'BRL',
                sector: 'General'
            });

            setStatus('success');
            setTimeout(() => {
                setStatus('idle');
                onClose();
            }, 1000);

        } catch (error) {
            console.error(error);
            setStatus('idle');
        }
    };

    const renderTickerField = () => {
        if (form.type === 'CASH') {
            return (
                <div className="opacity-50 pointer-events-none">
                     <Input label="Ativo (Automático)" value="RESERVA / CAIXA" readOnly containerClassName="mb-0" />
                </div>
            );
        }

        let placeholder = "Ex: PETR4";
        if (form.type === 'CRYPTO') placeholder = "Ex: BTC, ETH, SOL";
        if (form.type === 'STOCK_US') placeholder = "Ex: AAPL, NVDA";

        return (
            <Input 
                label="Código / Ticker"
                placeholder={placeholder}
                value={form.ticker}
                onChange={(e) => setForm({...form, ticker: e.target.value.toUpperCase()})}
                containerClassName="mb-0"
                className="uppercase font-mono tracking-wider"
            />
        );
    };

    const renderQuantityAndPriceFields = () => {
        if (form.type === 'CASH') {
            return (
                <div className="col-span-2">
                    <div className="relative">
                        <Input 
                            label="Valor Total do Aporte (R$)"
                            placeholder="0,00"
                            value={form.price}
                            onChange={handlePriceChange}
                            onBlur={handlePriceBlur}
                            containerClassName="mb-0"
                            className="pl-4 text-lg font-bold text-emerald-400"
                        />
                         <DollarSign className="absolute right-4 top-9 text-emerald-500/50 pointer-events-none" size={20} />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 ml-1">* Adicionado ao saldo da Reserva.</p>
                </div>
            );
        }

        return (
            <>
                <div className="relative">
                    <Input 
                        label={form.type === 'CRYPTO' ? "Quantidade" : "Quantidade (Cotas)"}
                        type="number"
                        step={form.type === 'CRYPTO' ? "0.00000001" : "1"}
                        placeholder={form.type === 'CRYPTO' ? "0.005" : "100"}
                        value={form.quantity}
                        onChange={(e) => setForm({...form, quantity: e.target.value})}
                        containerClassName="mb-0"
                    />
                    <BarChart2 className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>
                
                <div className="relative">
                    <Input 
                        label="Preço Unitário"
                        placeholder="0,00"
                        value={form.price}
                        onChange={handlePriceChange}
                        onBlur={handlePriceBlur}
                        containerClassName="mb-0"
                    />
                    <DollarSign className="absolute right-3 top-9 text-slate-600 pointer-events-none" size={16} />
                </div>
            </>
        );
    };

    // --- USO DE PORTAL: Renderiza diretamente no body ---
    return createPortal(
        <div className="relative z-[100]" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            {/* Container Centralizado */}
            <div className="fixed inset-0 z-10 overflow-y-auto">
                <div className="flex min-h-full items-center justify-center p-4 text-center sm:p-0">
                    
                    {/* Modal Panel */}
                    <div className="relative transform overflow-hidden rounded-2xl bg-[#080C14] border border-slate-800 text-left shadow-2xl transition-all w-full max-w-lg animate-fade-in my-8">
                        
                        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#0B101A]">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <PlusCircle size={18} className="text-blue-500" />
                                Adicionar Transação
                            </h2>
                            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-6">
                            <form onSubmit={handleSubmit} className="space-y-5">
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="col-span-2">
                                        <label className="text-[10px] font-bold uppercase text-slate-500 ml-1 mb-1.5 block">Tipo de Ativo</label>
                                        <div className="relative">
                                            <select 
                                                value={form.type}
                                                onChange={(e) => setForm({...form, type: e.target.value as AssetType})}
                                                className="w-full bg-[#0B101A] text-white text-sm border border-slate-800 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-600 outline-none appearance-none cursor-pointer"
                                            >
                                                <option value="STOCK">Ações BR</option>
                                                <option value="FII">Fundos Imobiliários</option>
                                                <option value="STOCK_US">Ações Exterior</option>
                                                <option value="CRYPTO">Criptomoedas</option>
                                                <option value="FIXED_INCOME">Renda Fixa</option>
                                                <option value="CASH">Reserva / Caixa</option>
                                            </select>
                                            <Tag className="absolute right-3 top-3.5 text-slate-600 pointer-events-none" size={14} />
                                        </div>
                                    </div>
                                    <Input 
                                        label="Data" type="date" value={form.date}
                                        onChange={(e) => setForm({...form, date: e.target.value})}
                                        containerClassName="mb-0 col-span-1"
                                    />
                                </div>

                                {renderTickerField()}

                                <div className="grid grid-cols-2 gap-4">
                                    {renderQuantityAndPriceFields()}
                                </div>

                                {form.type !== 'CASH' && (
                                    <Input 
                                        label="Descrição (Opcional)" placeholder="Ex: Aporte Mensal"
                                        value={form.name} onChange={(e) => setForm({...form, name: e.target.value})}
                                        containerClassName="mb-0"
                                    />
                                )}

                                <div className="pt-4 flex gap-3">
                                    <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Cancelar</Button>
                                    <Button type="submit" status={status} disabled={form.type !== 'CASH' && (!form.ticker || !form.quantity || !form.price)} className="flex-[2]">Confirmar</Button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};