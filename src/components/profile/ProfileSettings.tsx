import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

export const ProfileSettings = () => {
    const { user } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    
    // Dados iniciam vazios ou com dados reais do usuário, sem mocks de "Investidor Profissional"
    const [formData, setFormData] = useState({
        name: user?.name || '',
        phone: '',
        occupation: '',
        bio: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        // Simulação de API
        await new Promise(resolve => setTimeout(resolve, 1500));
        setIsLoading(false);
    };

    return (
        <div className="bg-[#080C14] border border-slate-800 rounded-2xl p-6">
            <h3 className="text-base font-bold text-white mb-1">Informações Pessoais</h3>
            <p className="text-xs text-slate-500 mb-6">Atualize seus dados de identificação e contato.</p>

            <form onSubmit={handleSave}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <Input 
                        label="Nome Completo" 
                        name="name" 
                        value={formData.name} 
                        onChange={handleChange}
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
                        containerClassName="opacity-80"
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