/**
 * AES-256-GCM para campos sensíveis em repouso (ex: mfaSecret no MongoDB).
 *
 * Formato do ciphertext armazenado: "<iv_hex>:<authTag_hex>:<data_hex>"
 *
 * ENCRYPTION_KEY deve ser 64 chars hex (= 32 bytes).
 * Gerar com: openssl rand -hex 32
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

const getKey = () => {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error('ENCRYPTION_KEY inválida: deve ter 64 caracteres hex (32 bytes).');
  }
  return Buffer.from(raw, 'hex');
};

export const encrypt = (plaintext) => {
  if (!plaintext) return plaintext;
  const key = getKey();
  const iv = randomBytes(12); // 96 bits — tamanho padrão para GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decrypt = (ciphertext) => {
  if (!ciphertext) return ciphertext;
  // Suporte retroativo: se o valor não tem o formato "iv:tag:data", assume texto claro
  // (migração gradual — usuários existentes com MFA antes da criptografia).
  if (!ciphertext.includes(':')) return ciphertext;
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext;
  const [ivHex, authTagHex, dataHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};

/**
 * Blind index — HMAC-SHA256 determinístico de um valor sensível.
 *
 * A criptografia AES-GCM usa IV aleatório, então o ciphertext de um mesmo CPF
 * é sempre diferente — inviável para busca de unicidade. O blind index resolve
 * isso: gera um hash estável (mesma entrada → mesma saída) que pode ser indexado
 * e consultado, sem revelar o valor original (chaveado com ENCRYPTION_KEY).
 *
 * Usado p/ enforçar unicidade de CPF (campo cpfHash) sem armazenar o CPF em claro.
 */
export const blindIndex = (plaintext) => {
  if (!plaintext) return plaintext;
  const key = getKey();
  return createHmac('sha256', key).update(String(plaintext)).digest('hex');
};
