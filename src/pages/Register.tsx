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
    if (!formData.name) newErrors.name = "Campo obrigatório";
    if (!formData.email) newErrors.email = "Campo obrigatório";
    else if (!formData.email.includes('@')) newErrors.email = "Inválido";
    
    if (!formData.password) newErrors.password = "Campo obrigatório";
    if (formData.password.length < 6) newErrors.password = "Mínimo 6 caracteres";
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Não confere";
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
      <div className="mb-6 text-center lg:text-left">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Nova Credencial</h2>
        <p className="text-slate-500 mt-1 text-xs font-medium">Preencha os dados para acessar a plataforma.</p>
      </div>

      {serverError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div>
            <Input 
              label="Nome" 
              name="name"
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
              disabled={status === 'loading' || status === 'success'}
            />

            <Input 
              label="Email" 
              name="email"
              type="email" 
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              disabled={status === 'loading' || status === 'success'}
            />
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <Input 
                label="Senha" 
                name="password"
                type="password" 
                value={formData.password}
                onChange={handleChange}
                error={errors.password}
                disabled={status === 'loading' || status === 'success'}
              />
              <Input 
                label="Confirmar Senha" 
                name="confirmPassword"
                type="password" 
                value={formData.confirmPassword}
                onChange={handleChange}
                error={errors.confirmPassword}
                disabled={status === 'loading' || status === 'success'}
              />
            </div>

            <div className="mt-4 flex items-start gap-3">
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
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 transition-colors cursor-pointer"
                    />
                </div>
                <div className="text-xs">
                    <div className="flex flex-wrap gap-1">
                        <label htmlFor="terms" className="font-medium text-slate-600 cursor-pointer select-none">
                            Li e concordo com os
                        </label>
                        <Link to="/terms" className="text-blue-600 hover:underline font-bold hover:text-blue-800 transition-colors">
                            Termos de Uso
                        </Link>
                        <label htmlFor="terms" className="font-medium text-slate-600 cursor-pointer select-none">
                            da plataforma.
                        </label>
                    </div>
                    {errors.terms && (
                        <p className="text-red-500 font-bold mt-1 animate-fade-in">{errors.terms}</p>
                    )}
                </div>
            </div>
        </div>

        <div className="pt-6">
            <Button type="submit" status={status}>Criar Conta</Button>
        </div>
      </form>

      <div className="mt-6 flex items-center justify-center gap-1.5">
        <span className="text-xs text-slate-500 font-medium">Já possui conta?</span>
        <Link to="/login" className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors">
            Fazer Login
        </Link>
      </div>
    </div>
  );
};