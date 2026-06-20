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
      }),

    // Consentimento LGPD (Art. 7, 8) — booleans enviados pelo frontend
    acceptedTerms: z.boolean().optional(),
    acceptedPrivacy: z.boolean().optional(),
    marketingOptIn: z.boolean().optional(),
  })
});

// Esquema de atualização de perfil (PUT /me). Todos os campos são opcionais
// (PATCH-like) — '' é aceito p/ sinalizar "remover" no controller. A validação
// fina de CPF/data/salário/banner permanece no controller (regras de negócio).
export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Nome deve ter no mínimo 2 caracteres").max(120).trim().optional(),
    cpf: z.string().max(20).optional(),
    phone: z.string().max(30).optional(),
    occupation: z.string().max(80).optional(),
    bannerColor: z.string().max(20).optional(),
    // (3.21) novos campos
    brokerage: z.string().max(80).optional(),
    cep: z.string().max(20).optional(),
    street: z.string().max(120).optional(),
    neighborhood: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    birthDate: z.string().max(10).optional(),
    // salary chega como número (ou string numérica) do formulário.
    salary: z.union([z.number(), z.string().max(20)]).nullable().optional(),
  })
});

// (3.17) Avatar: só o campo da imagem (data-URL). Tamanho/mime validados no
// controller; aqui garantimos apenas o tipo string e um teto bruto.
export const avatarSchema = z.object({
  body: z.object({
    avatar: z.string().max(500_000),
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