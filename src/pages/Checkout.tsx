import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, CreditCard, ChevronLeft } from 'lucide-react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { subscriptionService } from '../services/subscription';
import { useAuth } from '../contexts/AuthContext';

export const Checkout = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    
    const plan = searchParams.get('plan');
    const sessionId = searchParams.get('session_id');

    const [cardName, setCardName] = useState('');
    const [cardNumber, setCardNumber] = useState('');
    const [expiry, setExpiry] = useState('');
    const [cvc, setCvc] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    useEffect(() => {
        if (!plan || !sessionId) {
            navigate('/pricing');
        }
    }, [plan, sessionId, navigate]);

    const getPlanDetails = () => {
        switch(plan) {
            case 'ESSENTIAL': return { name: 'Essential', price: '39,90' };
            case 'PRO': return { name: 'Vértice Pro', price: '119,90' };
            case 'BLACK': return { name: 'Black Elite', price: '349,90' };
            default: return { name: 'Plano Desconhecido', price: '0,00' };
        }
    };

    const details = getPlanDetails();

    const handlePay = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus('loading');

        try {
            // Simulação de delay de rede
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await subscriptionService.confirmPayment(plan!, 'CREDIT_CARD');
            
            setStatus('success');
            setTimeout(() => {
                navigate(`/checkout/success?plan=${plan}`);
            }, 1000);
        } catch (error) {
            console.error(error);
            setStatus('error');
            setTimeout(() => setStatus('idle'), 3000);
        }
    };

    // Formatação de cartão (visual apenas)
    const handleCardNumber = (e: React.ChangeEvent<HTMLInputElement>) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 16);
        v = v.replace(/(.{4})/g, '$1 ').trim();
        setCardNumber(v);
    };

    const handleExpiry = (e: React.ChangeEvent<HTMLInputElement>) => {
        let v = e.target.value.replace(/\D/g, '').substring(0, 4);
        if (v.length >= 2) v = v.substring(0, 2) + '/' + v.substring(2);
        setExpiry(v);
    };

    return (
        <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans">
            {/* Header Seguro Isolado */}
            <div className="bg-white border-b border-slate-200 py-4 px-6 shadow-sm flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="text-blue-600" size={24} />
                    <span className="font-bold text-slate-800 tracking-tight">Vértice Secure Checkout</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                    <Lock size={10} />
                    <span className="font-bold uppercase tracking-wider">SSL Encrypted 256-bit</span>
                </div>
            </div>

            <div className="flex-1 flex items-center justify-center p-4">
                <div className="max-w-4xl w-full grid md:grid-cols-2 gap-8 items-start">
                    
                    {/* Resumo do Pedido (Esquerda) */}
                    <div className="hidden md:block pt-8">
                        <button onClick={() => navigate('/pricing')} className="flex items-center gap-1 text-slate-500 text-xs font-bold hover:text-slate-800 mb-6 transition-colors">
                            <ChevronLeft size={14} /> Cancelar e Voltar
                        </button>
                        
                        <div className="mb-8">
                            <p className="text-slate-500 text-xs uppercase font-bold tracking-wider mb-2">Você está assinando</p>
                            <h1 className="text-3xl font-bold text-slate-900">{details.name}</h1>
                            <div className="flex items-baseline gap-1 mt-1">
                                <span className="text-4xl font-bold text-slate-900">R$ {details.price}</span>
                                <span className="text-slate-500 font-medium">/ mês</span>
                            </div>
                        </div>

                        <div className="space-y-4 border-t border-slate-200 pt-6">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Subtotal</span>
                                <span className="font-medium text-slate-900">R$ {details.price}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-600">Taxas de Processamento</span>
                                <span className="font-medium text-slate-900">R$ 0,00</span>
                            </div>
                            <div className="flex justify-between text-base font-bold pt-4 border-t border-slate-200">
                                <span className="text-slate-900">Total Hoje</span>
                                <span className="text-blue-600">R$ {details.price}</span>
                            </div>
                        </div>

                        <p className="mt-8 text-xs text-slate-400 leading-relaxed">
                            Ao confirmar, você concorda com nossos Termos de Serviço. A renovação é automática a cada 30 dias. Você pode cancelar a qualquer momento no seu perfil.
                        </p>
                    </div>

                    {/* Formulário de Pagamento (Direita) */}
                    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
                         <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                            Pagamento via Cartão
                            <div className="flex gap-1 ml-auto">
                                <div className="h-5 w-8 bg-slate-100 rounded border border-slate-200"></div>
                                <div className="h-5 w-8 bg-slate-100 rounded border border-slate-200"></div>
                            </div>
                         </h2>

                         <form onSubmit={handlePay}>
                            <div className="space-y-5">
                                <Input 
                                    label="Nome no Cartão"
                                    placeholder="Como impresso no cartão"
                                    value={cardName}
                                    onChange={(e) => setCardName(e.target.value.toUpperCase())}
                                    containerClassName="mb-0"
                                    className="bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-blue-500 focus:bg-white"
                                />

                                <div className="relative">
                                    <Input 
                                        label="Número do Cartão"
                                        placeholder="0000 0000 0000 0000"
                                        value={cardNumber}
                                        onChange={handleCardNumber}
                                        maxLength={19}
                                        containerClassName="mb-0"
                                        className="bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-blue-500 focus:bg-white pl-10"
                                    />
                                    <CreditCard className="absolute left-3 top-8 text-slate-400" size={18} />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <Input 
                                        label="Validade"
                                        placeholder="MM/AA"
                                        value={expiry}
                                        onChange={handleExpiry}
                                        maxLength={5}
                                        containerClassName="mb-0"
                                        className="bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-blue-500 focus:bg-white"
                                    />
                                    <Input 
                                        label="CVC"
                                        placeholder="123"
                                        type="password"
                                        value={cvc}
                                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').substring(0,3))}
                                        maxLength={3}
                                        containerClassName="mb-0"
                                        className="bg-white border-slate-200 text-slate-800 placeholder:text-slate-400 focus:ring-blue-500 focus:bg-white"
                                    />
                                </div>
                            </div>

                            <div className="mt-8">
                                <Button 
                                    type="submit" 
                                    status={status}
                                    className="bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-600/20"
                                >
                                    Pagar R$ {details.price}
                                </Button>
                                <div className="text-center mt-3 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
                                    <Lock size={10} /> Pagamento processado de forma segura
                                </div>
                            </div>
                         </form>
                    </div>

                    {/* Mobile Summary (Visível apenas em mobile) */}
                    <div className="md:hidden text-center">
                        <p className="text-sm text-slate-500">Total a pagar</p>
                        <p className="text-2xl font-bold text-slate-900 mb-4">R$ {details.price}</p>
                        <button onClick={() => navigate('/pricing')} className="text-xs text-blue-600 font-bold">Cancelar Pedido</button>
                    </div>

                </div>
            </div>
        </div>
    );
};