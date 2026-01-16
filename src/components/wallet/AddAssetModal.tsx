import React, { useState, useEffect } from 'react';
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

    // Reset ao fechar ou abrir
    useEffect(() => {
        if (!isOpen) {
            setStatus('idle');
            setForm({ ticker: '', name: '', type: 'STOCK', quantity: '', price: '', date: new Date().toISOString().split('T')[0] });
        }
    }, [isOpen]);

    // Inteligência do Formulário: Ajustes automáticos ao mudar o Tipo
    useEffect(() => {
        if (form.type === 'CASH') {
            setForm(prev => ({ ...prev, ticker: 'RESERVA', quantity: '', price: '1,00' }));
        } else if (form.type === 'CRYPTO') {
            setForm(prev => ({ ...prev, ticker: '', quantity: '', price: '' }));
        } else {
             // Reset padrão para ações/fiis
             setForm(prev => ({ ...prev, ticker: '', quantity: '', price: '' }));
        }
    }, [form.type]);

    if (!isOpen) return null;

    const formatCurrencyInput = (value: string) => {
        // Remove tudo que não é dígito
        const digits = value.replace(/\D/g, "");
        // Converte para float (ex: 1234 -> 12.34)
        const amount = Number(digits) / 100;
        return amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        // Permite digitar, mas aplica máscara simples visual
        // Para inputs mais complexos, usar biblioteca de mask
        if(val === '') {
            setForm({...form, price: ''});
            return;
        }
        // Simples lógica: apenas números e vírgula
        setForm({...form, price: val});
    };
    
    // Handler inteligente para blur do preço (formata bonito)
    const handlePriceBlur = () => {
        if (!form.price) return;
        // Se o usuário digitou "50", vira "50,00". Se "50.5", vira "50,50"
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

            // Tratamento Inteligente dos Dados
            let finalTicker = form.ticker.toUpperCase();
            let finalQty = Number(form.quantity.replace(',', '.'));
            let finalPrice = Number(form.price.replace(/\./g, '').replace(',', '.'));

            // Caso Reserva/Caixa: O usuário digita VALOR TOTAL no campo "quantity" (visual),
            // mas internamente tratamos como Qty=Valor e Preço=1 (ou vice-versa).
            // AQUI: Usamos a lógica onde o input visual "Valor Total" foi salvo em `quantity` ou `price`?
            // Vamos checar o render: Para CASH, mostramos apenas "Valor Total". Vamos salvar isso em `quantity` (que será o valor monetário) e `price` será 1.
            if (form.type === 'CASH') {
                // No form de cash, usamos o campo "price" para o valor total, visualmente.
                // Mas a lógica do sistema espera Qtd * Preço.
                // Então: Qtd = 1, Preço = Valor Digitado.
                finalQty = 1;
                // O valor digitado no campo de preço (que rotulamos como Valor Total)
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

    // --- RENDERIZADORES DE CAMPOS CONDICIONAIS ---

    const renderTickerField = () => {
        if (form.type === 'CASH') {
            return (
                <div className="opacity-50 pointer-events-none">
                     <Input 
                        label="Ativo (Automático)"
                        value="RESERVA / CAIXA"
                        readOnly
                        containerClassName="mb-0"
                    />
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
        // Lógica Especial para CAIXA (Apenas Valor Total)
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
                    <p className="text-[10px] text-slate-500 mt-2 ml-1">
                        * O valor será adicionado ao saldo da sua Reserva de Oportunidade.
                    </p>
                </div>
            );
        }

        // Lógica Padrão (Qtd + Preço)
        return (
            <>
                <div className="relative">
                    <Input 
                        label={form.type === 'CRYPTO' ? "Quantidade (Frações)" : "Quantidade (Cotas)"}
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

    return (
        <div className="fixed inset-0 z-[60] h-screen w-screen flex items-center justify-center overflow-hidden">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={onClose}></div>

            <div className="relative z-10 bg-[#080C14] border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
                
                <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-[#0B101A] shrink-0 rounded-t-2xl">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <PlusCircle size={18} className="text-blue-500" />
                        Adicionar Transação
                    </h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto custom-scrollbar">
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
                                label="Data"
                                type="date"
                                value={form.date}
                                onChange={(e) => setForm({...form, date: e.target.value})}
                                containerClassName="mb-0 col-span-1"
                            />
                        </div>

                        {renderTickerField()}

                        {/* Campos de Quantidade e Preço (Layout Grid) */}
                        <div className="grid grid-cols-2 gap-4">
                            {renderQuantityAndPriceFields()}
                        </div>

                        {/* Campo Nome (Opcional, visível apenas se não for CASH) */}
                        {form.type !== 'CASH' && (
                            <Input 
                                label="Descrição (Opcional)"
                                placeholder="Ex: Aporte Mensal"
                                value={form.name}
                                onChange={(e) => setForm({...form, name: e.target.value})}
                                containerClassName="mb-0"
                            />
                        )}

                        <div className="pt-4 flex gap-3">
                            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
                                Cancelar
                            </Button>
                            <Button 
                                type="submit" 
                                status={status} 
                                disabled={form.type !== 'CASH' && (!form.ticker || !form.quantity || !form.price)}
                                className="flex-[2]"
                            >
                                Confirmar Transação
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};