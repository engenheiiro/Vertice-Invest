
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { authService } from '../../services/auth';
import { CheckCircle2, AlertCircle, User, Loader2 } from 'lucide-react';
import { getErrorMessage } from '../../utils/errorMessages';

// (3.21a) Corretoras conhecidas — espelha a lista do backend. "Outra" libera
// um campo de texto livre.
const BROKERAGES = [
    'XP Investimentos', 'BTG Pactual', 'Rico', 'Clear', 'Inter',
    'Nubank/NuInvest', 'Itaú/Íon', 'Toro', 'Genial', 'Ágora', 'Modalmais',
    'Guide', 'Órama', 'Santander Corretora', 'Caixa Corretora',
];

export const ProfileSettings = () => {
    const { user, refreshProfile } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [cepLoading, setCepLoading] = useState(false);
    const [msg, setMsg] = useState<{type: 'success' | 'error', text: string} | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        occupation: '',
        cpf: '',
        // (3.21) novos campos
        brokerage: '',      // valor do select (uma corretora conhecida ou 'Outra')
        brokerageOther: '', // texto livre quando brokerage === 'Outra'
        cep: '',
        street: '',
        neighborhood: '',
        city: '',
        state: '',
        birthDate: '',
        salary: '',
    });

    useEffect(() => {
        if (user) {
            const known = user.brokerage && BROKERAGES.includes(user.brokerage);
            setFormData({
                name: user.name || '',
                phone: user.phone || '',
                occupation: user.occupation || '',
                cpf: user.cpf || '',
                brokerage: user.brokerage ? (known ? user.brokerage : 'Outra') : '',
                brokerageOther: user.brokerage && !known ? user.brokerage : '',
                cep: user.cep || '',
                street: user.street || '',
                neighborhood: user.neighborhood || '',
                city: user.city || '',
                state: user.state || '',
                birthDate: user.birthDate || '',
                salary: user.salary != null ? String(user.salary) : '',
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

    const formatCEP = (value: string) =>
        value.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

    // (3.21b) Autopreenchimento via ViaCEP (gratuito, sem chave, CORS liberado).
    const lookupCep = async (rawCep: string) => {
        const digits = rawCep.replace(/\D/g, '');
        if (digits.length !== 8) return;
        setCepLoading(true);
        try {
            const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
            const data = await res.json();
            if (data?.erro) {
                setMsg({ type: 'error', text: 'CEP não encontrado.' });
                return;
            }
            setFormData(prev => ({
                ...prev,
                street: data.logradouro || prev.street,
                neighborhood: data.bairro || prev.neighborhood,
                city: data.localidade || prev.city,
                state: data.uf || prev.state,
            }));
            if (msg) setMsg(null);
        } catch {
            setMsg({ type: 'error', text: 'Não foi possível consultar o CEP.' });
        } finally {
            setCepLoading(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        let finalValue = value;

        if (name === 'cpf') finalValue = formatCPF(value);
        if (name === 'cep') finalValue = formatCEP(value);

        setFormData({ ...formData, [name]: finalValue });
        if (msg) setMsg(null);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        if (formData.cpf && !validateCPF(formData.cpf)) {
            setMsg({ type: 'error', text: 'CPF inválido.' });
            return;
        }

        // Resolve a corretora final: "Outra" → usa o texto livre.
        const brokerage = formData.brokerage === 'Outra'
            ? formData.brokerageOther.trim()
            : formData.brokerage;

        setIsLoading(true);
        setMsg(null);

        try {
            await authService.updateProfile({
                name: formData.name,
                cpf: formData.cpf,
                phone: formData.phone,
                occupation: formData.occupation,
                brokerage,
                cep: formData.cep,
                street: formData.street,
                neighborhood: formData.neighborhood,
                city: formData.city,
                state: formData.state,
                birthDate: formData.birthDate,
                // string vazia → backend remove; número caso contrário.
                salary: formData.salary === '' ? '' : Number(formData.salary),
            });

            await refreshProfile(); // Atualiza contexto
            setMsg({ type: 'success', text: 'Perfil atualizado com sucesso.' });

        } catch (error: unknown) {
            setMsg({ type: 'error', text: getErrorMessage(error, 'Erro ao salvar perfil.') });
        } finally {
            setIsLoading(false);
        }
    };

    // Classe base de um <select> alinhada visualmente ao componente Input.
    const selectClass = "w-full rounded-xl border-0 ring-1 ring-inset ring-slate-800 hover:ring-slate-700 focus:ring-2 focus:ring-blue-600 transition-all outline-none font-medium text-sm bg-card text-slate-200 px-4 py-3";
    const labelClass = "text-[10px] font-bold uppercase tracking-wider ml-1 text-slate-500";

    return (
        <div className="bg-base border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-1">
                <User size={16} className="text-blue-500" />
                <h3 className="text-base font-bold text-white">Informações Pessoais</h3>
            </div>
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

                    {/* (3.21c) Data de Nascimento */}
                    <Input
                        label="Data de Nascimento"
                        name="birthDate"
                        type="date"
                        value={formData.birthDate}
                        onChange={handleChange}
                    />

                    {/* (3.21d) Salário atual */}
                    <Input
                        label="Salário Atual (R$)"
                        name="salary"
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="Ex: 8000"
                        value={formData.salary}
                        onChange={handleChange}
                    />

                    {/* (3.21a) Principal Corretora */}
                    <div className={`flex flex-col gap-1.5 ${formData.brokerage === 'Outra' ? '' : 'md:col-span-2'}`}>
                        <label className={labelClass} htmlFor="brokerage">Principal Corretora</label>
                        <select id="brokerage" name="brokerage" value={formData.brokerage} onChange={handleChange} className={selectClass}>
                            <option value="">Selecione…</option>
                            {BROKERAGES.map(b => <option key={b} value={b}>{b}</option>)}
                            <option value="Outra">Outra</option>
                        </select>
                    </div>

                    {formData.brokerage === 'Outra' && (
                        <Input
                            label="Qual corretora?"
                            name="brokerageOther"
                            placeholder="Digite o nome da corretora"
                            value={formData.brokerageOther}
                            onChange={handleChange}
                            maxLength={80}
                        />
                    )}

                    {/* (3.21b) Endereço via CEP */}
                    <div className="flex flex-col gap-1.5 relative">
                        <label className={labelClass} htmlFor="cep">CEP</label>
                        <div className="relative">
                            <Input
                                id="cep"
                                name="cep"
                                placeholder="00000-000"
                                value={formData.cep}
                                onChange={handleChange}
                                onBlur={() => lookupCep(formData.cep)}
                                maxLength={9}
                                containerClassName="mb-0"
                            />
                            {cepLoading && (
                                <Loader2 size={16} className="animate-spin text-blue-500 absolute right-3 top-1/2 -translate-y-1/2" />
                            )}
                        </div>
                    </div>

                    <Input
                        label="Cidade"
                        name="city"
                        placeholder="Preenchido pelo CEP"
                        value={formData.city}
                        onChange={handleChange}
                    />

                    <Input
                        label="Logradouro"
                        name="street"
                        placeholder="Rua / Avenida"
                        value={formData.street}
                        onChange={handleChange}
                    />

                    <Input
                        label="Bairro"
                        name="neighborhood"
                        placeholder="Bairro"
                        value={formData.neighborhood}
                        onChange={handleChange}
                    />

                    <Input
                        label="Estado (UF)"
                        name="state"
                        placeholder="UF"
                        value={formData.state}
                        onChange={handleChange}
                        maxLength={40}
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
