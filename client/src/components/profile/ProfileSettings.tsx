
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { authService } from '../../services/auth';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export const ProfileSettings = () => {
    const { user, refreshProfile } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [msg, setMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);
    
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        occupation: '',
        cpf: ''
    });

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name || '',
                phone: '', // Telefone e ocupação não estão no user context por padrão, idealmente viriam da API
                occupation: '',
                cpf: (user as any).cpf || ''
            });
        }
    }, [user]);

    // Função de validação de CPF (Módulo 11)
    const validateCPF = (cpf: string) => {
        cpf = cpf.replace(/[^\d]+/g, '');
        if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
        let add = 0;
        for (let i = 0; i < 9; i++) add += parseInt(cpf.charAt(i)) * (10 - i);
        let rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        if (rev !== parseInt(cpf.charAt(9))) return false;
        add = 0;
        for (let i = 0; i < 10; i++) add += parseInt(cpf.charAt(i)) * (11 - i);
        rev = 11 - (add % 11);
        if (rev === 10 || rev === 11) rev = 0;
        return rev === parseInt(cpf.charAt(10));
    };

    const formatCPF = (value: string) => {
        return value
            .replace(/\D/g, '')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d)/, '$1.$2')
            .replace(/(\d{3})(\d{1,2})/, '$1-$2')
            .replace(/(-\d{2})\d+?$/, '$1');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        let finalValue = value;
        
        if (name === 'cpf') {
            finalValue = formatCPF(value);
        }
        
        setFormData({ ...formData, [name]: finalValue });
        if (msg) setMsg(null);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (formData.cpf && !validateCPF(formData.cpf)) {
            setMsg({ type: 'error', text: 'CPF inválido.' });
            return;
        }

        setIsLoading(true);
        setMsg(null);

        try {
            await authService.updateProfile({
                name: formData.name,
                cpf: formData.cpf,
                // phone e occupation seriam enviados se o backend suportasse
            });
            
            await refreshProfile(); // Atualiza contexto
            setMsg({ type: 'success', text: 'Perfil atualizado com sucesso.' });
            
        } catch (error: any) {
            setMsg({ type: 'error', text: error.message || 'Erro ao salvar perfil.' });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6">
            <h3 className="text-base font-bold text-white mb-1">Informações Pessoais</h3>
            <p className="text-xs text-slate-500 mb-6">Atualize seus dados de identificação e contato.</p>

            {msg && (
                <div className={`mb-4 p-3 rounded-xl border flex items-center gap-2 text-xs font-bold animate-fade-in ${
                    msg.type === 'success' 
                    ? 'bg-emerald-900/20 border-emerald-900/50 text-emerald-400' 
                    : 'bg-red-900/20 border-red-900/50 text-red-400'
                }`}>
                    {msg.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {msg.text}
                </div>
            )}

            <form onSubmit={handleSave}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Input 
                        label="Nome Completo" 
                        name="name" 
                        value={formData.name} 
                        onChange={handleChange}
                    />
                    
                    <Input 
                        label="CPF" 
                        name="cpf" 
                        placeholder="000.000.000-00"
                        value={formData.cpf} 
                        onChange={handleChange}
                        maxLength={14}
                    />
                    
                    <Input 
                        label="Telefone / WhatsApp" 
                        name="phone" 
                        placeholder="(00) 00000-0000"
                        value={formData.phone} 
                        onChange={handleChange}
                    />
                    
                    <Input 
                        label="Ocupação Principal" 
                        name="occupation" 
                        placeholder="Ex: Engenheiro, Trader..."
                        value={formData.occupation} 
                        onChange={handleChange}
                    />

                    {/* Campo de Email Padronizado (Read Only) */}
                    <Input 
                        label="Email (Imutável)"
                        name="email"
                        value={user?.email || ''}
                        readOnly
                        disabled
                        containerClassName="opacity-60 md:col-span-2"
                    />
                </div>

                <div className="flex justify-end pt-6 border-t border-slate-800/50 mt-4">
                    <div className="w-full md:w-32">
                        <Button type="submit" isLoading={isLoading} status={isLoading ? 'loading' : 'idle'}>
                            Salvar
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    );
};
