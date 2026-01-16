import { z } from 'zod';

// Esquema de Registro
export const registerSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Nome é obrigatório" })
      .min(2, "Nome deve ter no mínimo 2 caracteres")
      .trim(),
    
    email: z.string({ required_error: "Email é obrigatório" })
      .email("Formato de email inválido")
      .toLowerCase() // Normalização automática
      .trim(),
    
    password: z.string({ required_error: "Senha é obrigatória" })
      .min(6, "Senha deve ter no mínimo 6 caracteres")
  })
});

// Esquema de Login
export const loginSchema = z.object({
  body: z.object({
    email: z.string({ required_error: "Email é obrigatório" })
      .email("Formato de email inválido")
      .toLowerCase() // Garante consistência na busca
      .trim(),
      
    password: z.string({ required_error: "Senha é obrigatória" })
      .min(1, "Senha é obrigatória")
  })
});