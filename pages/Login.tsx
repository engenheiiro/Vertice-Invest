import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';

export const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{email?: string, password?: string}>({});
  const [serverError, setServerError] = useState('');

  const validate = () => {
    const newErrors: {email?: string, password?: string} = {};
    if (!email) newErrors.email = "Obrigatório";
    if (!password) newErrors.password = "Obrigatório";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;
    
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        // Sucesso: Salva dados do usuário (não sensíveis)
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/dashboard');
      } else {
        // Erro retornado pela API (ex: senha incorreta)
        setServerError(data.message || 'Credenciais inválidas.');
      }

    } catch (error) {
      console.error("Erro de conexão:", error);
      setServerError('Servidor indisponível. Verifique sua conexão ou tente mais tarde.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full">
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
          placeholder="nome@empresa.com" 
          value={email}
          onChange={(e) => {
             setEmail(e.target.value);
             if (errors.email) setErrors({...errors, email: undefined});
             setServerError('');
          }}
          error={errors.email}
          disabled={isLoading}
        />
        
        <div className="relative">
          <Input 
            label="Senha" 
            type="password" 
            placeholder="••••••••" 
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) setErrors({...errors, password: undefined});
              setServerError('');
            }}
            error={errors.password}
            disabled={isLoading}
          />
          <button 
            type="button"
            className="absolute right-0 top-0 text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-wide"
          >
            Esqueceu a senha?
          </button>
        </div>

        <div className="pt-6">
            <Button type="submit" isLoading={isLoading}>Entrar</Button>
        </div>
      </form>

      <div className="mt-6 flex items-center justify-center gap-1.5">
        <span className="text-xs text-slate-500 font-medium">Ainda não é membro?</span>
        <Link 
            to="/register" 
            className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline transition-colors"
        >
            Solicitar Acesso
        </Link>
      </div>
    </div>
  );
};