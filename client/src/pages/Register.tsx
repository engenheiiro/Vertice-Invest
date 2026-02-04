
import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';

export const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    // Validação de Nome (Mínimo 2 nomes ou 3 chars)
    if (!formData.name.trim()) {
        newErrors.name = "Nome é obrigatório";
    } else if (formData.name.trim().length < 3) {
        newErrors.name = "Nome muito curto";
    } else if (!/^[a-zA-ZÀ-ÿ\s]+$/.test(formData.name)) {
        newErrors.name = "Nome contém caracteres inválidos";
    }

    // Validação de Email (Regex Estrito)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email) {
        newErrors.email = "Email é obrigatório";
    } else if (!emailRegex.test(formData.email)) {
        newErrors.email = "Formato de email inválido";
    }
    
    // Validação de Senha
    if (!formData.password) {
        newErrors.password = "Senha é obrigatória";
    } else if (formData.password.length < 6) {
        newErrors.password = "A senha deve ter no mínimo 6 caracteres";
    }
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "As senhas não coincidem";
    }

    if (!acceptedTerms) {
        newErrors.terms = "Você deve aceitar os termos";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;

    setStatus('loading');

    try {
      await authService.register({
        name: formData.name,
        email: formData.email,
        password: formData.password
      });

      setStatus('success');
      setTimeout(() => {
          navigate('/login');
      }, 1500);

    } catch (error: any) {
      console.error("Erro de registro:", error);
      setServerError(error.message || 'Erro ao criar conta.');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    setServerError('');
    if (status === 'error') setStatus('idle');
  };

  return (
    <div className="w-full">
      <div className="mb-3 text-center lg:text-left">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Nova Credencial</h2>
        <p className="text-slate-500 text-[11px] font-medium">Preencha os dados para acessar.</p>
      </div>

      {serverError && (
        <div className="mb-2 p-1.5 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div>
            <Input 
              label="Nome Completo" 
              name="name"
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-2"
              className="px-3 py-2.5 text-sm"
              placeholder="Ex: João Silva"
            />

            <Input 
              label="Email Corporativo ou Pessoal" 
              name="email"
              type="email" 
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              disabled={status === 'loading' || status === 'success'}
              containerClassName="mb-2"
              className="px-3 py-2.5 text-sm"
              placeholder="Ex: joao@email.com"
            />
            
            <div className="grid grid-cols-2 gap-2 mt-1">
              <Input 
                label="Senha" 
                name="password"
                type="password" 
                value={formData.password}
                onChange={handleChange}
                error={errors.password}
                disabled={status === 'loading' || status === 'success'}
                containerClassName="mb-2"
                className="px-3 py-2.5 text-sm"
              />
              <Input 
                label="Confirmar" 
                name="confirmPassword"
                type="password" 
                value={formData.confirmPassword}
                onChange={handleChange}
                error={errors.confirmPassword}
                disabled={status === 'loading' || status === 'success'}
                containerClassName="mb-2"
                className="px-3 py-2.5 text-sm"
              />
            </div>

            <div className="mt-2 flex items-start gap-2">
                <div className="flex items-center h-5">
                    <input
                        id="terms"
                        name="terms"
                        type="checkbox"
                        checked={acceptedTerms}
                        onChange={(e) => {
                            setAcceptedTerms(e.target.checked);
                            if (errors.terms) setErrors({...errors, terms: ''});
                        }}
                        disabled={status === 'loading' || status === 'success'}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600 transition-colors cursor-pointer"
                    />
                </div>
                <div className="text-[11px] leading-tight">
                    <div className="flex flex-wrap gap-1">
                        <label htmlFor="terms" className="font-medium text-slate-600 cursor-pointer select-none">
                            Li e concordo com os
                        </label>
                        <Link to="/terms" className="text-blue-600 hover:underline font-bold hover:text-blue-800 transition-colors">
                            Termos de Uso
                        </Link>
                    </div>
                    {errors.terms && (
                        <p className="text-red-500 font-bold mt-0.5 animate-fade-in">{errors.terms}</p>
                    )}
                </div>
            </div>
        </div>

        <div className="pt-3">
            <Button type="submit" status={status} className="py-2.5 text-sm">Criar Conta</Button>
        </div>
      </form>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        <span className="text-[11px] text-slate-500 font-medium">Já possui conta?</span>
        <Link to="/login" className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors">
            Fazer Login
        </Link>
      </div>
    </div>
  );
};
