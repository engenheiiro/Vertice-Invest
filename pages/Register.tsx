import React, { useState } from 'react';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Link, useNavigate } from 'react-router-dom';
import { API_URL } from '../config';

export const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name) newErrors.name = "Obrigatório";
    if (!formData.email) newErrors.email = "Obrigatório";
    else if (!formData.email.includes('@')) newErrors.email = "Inválido";
    
    if (!formData.password) newErrors.password = "Obrigatório";
    if (formData.password.length < 6) newErrors.password = "Mínimo 6 caracteres";
    
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Não confere";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (!validate()) return;

    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password
        })
      });

      const data = await response.json();

      if (response.ok) {
        navigate('/login');
      } else {
        setServerError(data.message || 'Erro ao criar conta.');
      }

    } catch (error) {
      console.error("Erro de conexão:", error);
      setServerError('Servidor indisponível. Verifique sua conexão ou tente mais tarde.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
    setServerError('');
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

      <form onSubmit={handleSubmit}>
        <div className="space-y-1">
            <Input 
              label="Nome" 
              name="name"
              placeholder="Nome completo" 
              value={formData.name}
              onChange={handleChange}
              error={errors.name}
              disabled={isLoading}
            />

            <Input 
              label="Email" 
              name="email"
              type="email" 
              placeholder="nome@empresa.com" 
              value={formData.email}
              onChange={handleChange}
              error={errors.email}
              disabled={isLoading}
            />
            
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Input 
                label="Senha" 
                name="password"
                type="password" 
                placeholder="••••••" 
                value={formData.password}
                onChange={handleChange}
                error={errors.password}
                disabled={isLoading}
              />
              <Input 
                label="Confirmar Senha" 
                name="confirmPassword"
                type="password" 
                placeholder="••••••" 
                value={formData.confirmPassword}
                onChange={handleChange}
                error={errors.confirmPassword}
                disabled={isLoading}
              />
            </div>
        </div>

        <div className="pt-6">
            <Button type="submit" isLoading={isLoading}>Criar Conta</Button>
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