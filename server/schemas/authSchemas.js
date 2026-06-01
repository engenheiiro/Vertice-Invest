import { z } from 'zod';
import { getPasswordError } from '../utils/passwordPolicy.js';

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

    // (S6) Política forte e única (8+, maiúscula, minúscula, dígito, não-comum),
    // alinhada à validação de reset/troca de senha no authController.
    password: z.string({ required_error: "Senha é obrigatória" })
      .superRefine((val, ctx) => {
        const err = getPasswordError(val);
        if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
      })
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