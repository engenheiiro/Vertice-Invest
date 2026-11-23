import User from '../../models/User.js';
import { encrypt, blindIndex } from '../../utils/encryption.js'; // (S) cripto em repouso: CPF, nascimento, salário
import { validateCpf } from '../../utils/cpfUtils.js';

// Monta o update do PUT /me a partir do corpo. Só os campos abaixo entram no
// $set/$unset: plano, papel, e-mail, senha e sessionVersion nunca são lidos do
// corpo. Cada aplicador devolve o erro ({ status, message }) ou null; a ordem
// das validações é a ordem em que o erro aparece para o cliente.

// Banner de perfil (3.20): só aceita presets conhecidos.
const BANNER_PRESETS = ['ocean', 'emerald', 'royal', 'sunset', 'gold', 'graphite'];
const ADDRESS_KEYS = ['cep', 'street', 'neighborhood', 'city', 'state'];
const BIRTH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const invalid = (message) => ({ status: 400, message });
const trimmedOrEmpty = (raw) => (typeof raw === 'string' ? raw.trim() : '');

// Texto livre em claro: '' → $unset; acima do teto → erro.
const applyText = (ops, key, raw, maxLength, message) => {
  const v = trimmedOrEmpty(raw);
  if (v === '') ops.unset[key] = 1;
  else if (v.length > maxLength) return invalid(message);
  else ops.set[key] = v;
  return null;
};

// (3.21a) Corretora — texto livre (lista conhecida + "Outra"). Só valida tamanho.
const applyBrokerage = (ops, brokerage) => (
  brokerage === undefined ? null : applyText(ops, 'brokerage', brokerage, 80, 'Corretora inválida.')
);

// (3.21b) Endereço (ViaCEP) — campos em claro.
const applyAddress = (ops, body) => {
  for (const key of ADDRESS_KEYS) {
    if (body[key] === undefined) continue;
    const error = applyText(ops, key, body[key], 120, 'Endereço inválido.');
    if (error) return error;
  }
  return null;
};

// Data real e plausível: não futura, idade ≤ 120 anos.
const isPlausibleBirthDate = (v) => {
  if (!BIRTH_DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  const now = new Date();
  const min = new Date(); min.setUTCFullYear(now.getUTCFullYear() - 120);
  return !(Number.isNaN(d.getTime()) || v !== d.toISOString().slice(0, 10) || d > now || d < min);
};

// (3.21c) Data de nascimento — YYYY-MM-DD, cifrada em repouso.
const applyBirthDate = (ops, birthDate) => {
  if (birthDate === undefined) return null;
  const v = trimmedOrEmpty(birthDate);
  if (v === '') ops.unset.birthDate = 1;
  else if (!isPlausibleBirthDate(v)) return invalid('Data de nascimento inválida.');
  else ops.set.birthDate = encrypt(v); // cifra em repouso (AES-256-GCM)
  return null;
};

// (3.21d) Salário atual — número não-negativo, cifrado em repouso.
const applySalary = (ops, salary) => {
  if (salary === undefined) return null;
  if (salary === null || salary === '') { ops.unset.salary = 1; return null; }
  const n = Number(salary);
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return invalid('Salário inválido.');
  ops.set.salary = encrypt(String(n)); // cifra em repouso (AES-256-GCM)
  return null;
};

// '' ou null remove a escolha (volta ao gradiente padrão do plano).
const applyBanner = (ops, bannerColor) => {
  if (bannerColor === undefined) return null;
  if (bannerColor === '' || bannerColor === null) ops.unset.bannerColor = 1;
  else if (BANNER_PRESETS.includes(bannerColor)) ops.set.bannerColor = bannerColor;
  else return invalid('Banner inválido.');
  return null;
};

const applyCpf = async (ops, userId, cpf, cleanCpf) => {
  if (!cleanCpf) {
    // Campo enviado vazio → titular quer remover o CPF. $unset evita deixar
    // cpfHash=null (que colidiria no índice único sparse entre vários usuários).
    if (cpf !== undefined) { ops.unset.cpf = 1; ops.unset.cpfHash = 1; }
    return null;
  }
  if (!validateCpf(cleanCpf)) return invalid('CPF inválido.');
  // Unicidade via blind index (CPF cifrado não é comparável diretamente).
  const cpfHash = blindIndex(cleanCpf);
  const existing = await User.findOne({ cpfHash }).select('_id');
  if (existing && existing._id.toString() !== userId) return { status: 409, message: 'CPF já utilizado.' };
  ops.set.cpf = encrypt(cleanCpf); // cifra em repouso (AES-256-GCM)
  ops.set.cpfHash = cpfHash;
  return null;
};

/** Devolve `{ error }` (status + mensagem) ou `{ updateOps }` para o findByIdAndUpdate. */
export const buildProfileUpdate = async (userId, body) => {
  const { name, cpf, phone, occupation } = body;
  const cleanCpf = cpf ? cpf.replace(/\D/g, '') : null;

  // $set ignora chaves undefined (deixa o campo inalterado quando vazio).
  const ops = { set: { name, phone: phone || undefined, occupation: occupation || undefined }, unset: {} };
  const error = applyBrokerage(ops, body.brokerage)
    || applyAddress(ops, body)
    || applyBirthDate(ops, body.birthDate)
    || applySalary(ops, body.salary)
    || applyBanner(ops, body.bannerColor)
    || await applyCpf(ops, userId, cpf, cleanCpf);
  if (error) return { error };

  const updateOps = { $set: ops.set };
  if (Object.keys(ops.unset).length) updateOps.$unset = ops.unset;
  return { updateOps };
};
