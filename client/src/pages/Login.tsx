import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';
import { ArrowLeft } from 'lucide-react';

export const Login = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [errors, setErrors] = useState<{email?: string, password?: string}>({});
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const newErrors: {email?: string, password?: string} = {};
    if (!email.trim()) newErrors.email = "Campo obrigatório";
    if (!password) newErrors.password = "Campo obrigatório";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;
    
    setStatus('loading');

    try {
      const response = await authService.login({ email, password });
      
      if (response.user && response.accessToken) {
          login(response.user, response.accessToken);
          setStatus('success');
          setTimeout(() => {
              navigate('/dashboard');
          }, 1000);
      } else {
          throw new Error("Resposta inválida do servidor");
      }

    } catch (error: any) {
      console.error("Erro de login:", error);
      setServerError(error.message || 'Servidor indisponível.');
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };

  return (
    <div className="w-full relative">
      {/* Botão de Voltar Profissional */}
      <div className="mb-8">
        <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-blue-600 transition-colors group"
        >
            <ArrowLeft size={12} className="group-hover:-translate-x-1 transition-transform duration-300" />
            Voltar ao Início
        </Link>
      </div>

      <div className="mb-4 text-center lg:text-left">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">Portal do Investidor</h2>
        <p className="text-slate-500 text-[11px] font-medium">Insira suas credenciais para continuar.</p>
      </div>

      {serverError && (
        <div className="mb-3 p-2 bg-red-50 text-red-600 text-[10px] font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <Input 
          label="Email" 
          type="email" 
          value={email}
          onChange={(e) => {
             setEmail(e.target.value);
             if (errors.email) setErrors({...errors, email: undefined});
             setServerError('');
             if (status === 'error') setStatus('idle');
          }}
          error={errors.email}
          disabled={status === 'loading' || status === 'success'}
          containerClassName="mb-3"
          className="px-4 py-2.5 text-sm" // Compacto
        />
        
        <div className="relative">
          <Input 
            label="Senha" 
            type="password" 
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors({...errors, password: undefined});
              setServerError('');
              if (status === 'error') setStatus('idle');
            }}
            error={errors.password}
            disabled={status === 'loading' || status === 'success'}
            containerClassName="mb-1"
            className="px-4 py-2.5 text-sm" // Compacto
          />
          <Link 
            to="/forgot-password"
            className="absolute right-0 top-0 text-[9px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-wide cursor-pointer z-10"
          >
            Esqueceu a senha?
          </Link>
        </div>

        <div className="pt-3">
            <Button type="submit" status={status} className="py-2.5 text-sm">Entrar</Button>
        </div>
      </form>

      <div className="mt-3 flex items-center justify-center gap-1.5">
        <span className="text-[11px] text-slate-500 font-medium">Ainda não é membro?</span>
        <Link 
            to="/register" 
            className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
        >
            Cadastre-se
        </Link>
      </div>
    </div>
  );
};