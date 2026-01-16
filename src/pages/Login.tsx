import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button, ButtonStatus } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';

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
      <div className="mb-6 text-center lg:text-left">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Portal do Investidor</h2>
        <p className="text-slate-500 mt-1 text-xs font-medium">Insira suas credenciais para continuar.</p>
      </div>

      {serverError && (
        <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-lg border border-red-100 flex items-center justify-center animate-fade-in text-center">
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
          />
          <Link 
            to="/forgot-password"
            className="absolute right-0 top-0 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-wide cursor-pointer"
          >
            Esqueceu a senha?
          </Link>
        </div>

        <div className="pt-6">
            <Button type="submit" status={status}>Entrar</Button>
        </div>
      </form>

      <div className="mt-6 flex items-center justify-center gap-1.5">
        <span className="text-xs text-slate-500 font-medium">Ainda não é membro?</span>
        <Link 
            to="/register" 
            className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
        >
            Cadastre-se
        </Link>
      </div>
    </div>
  );
};