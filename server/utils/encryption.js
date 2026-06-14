/**
 * AES-256-GCM para campos sensíveis em repouso (ex: mfaSecret e CPF no MongoDB).
 *
 * Formato do ciphertext armazenado:
 *   - Versionado (atual): "<keyId>:<iv_hex>:<authTag_hex>:<data_hex>" (4 partes)
 *   - Legado (pré-S1.6):  "<iv_hex>:<authTag_hex>:<data_hex>"        (3 partes)
 *                          → decifrado com a chave v1 (ENCRYPTION_KEY).
 *   - Texto sem ":"       → assume valor em claro (migração gradual).
 *
 * ENCRYPTION_KEY (=v1) deve ser 64 chars hex (= 32 bytes). Gerar com:
 *   openssl rand -hex 32
 *
 * ── Versionamento de chaves (S1.6) ───────────────────────────────────────────
 * Permite rotacionar a chave de criptografia sem reescrever todos os ciphertexts
 * de uma vez (e sem quebrar usuários com 2FA/CPF já cifrados):
 *
 *   - `v1` é SEMPRE a ENCRYPTION_KEY — compatível com tudo que já está cifrado.
 *   - Chaves adicionais entram via ENCRYPTION_KEYS, no formato:
 *         "v2=<64hex>;v3=<64hex>"
 *   - A chave usada para CIFRAR novos valores é ENCRYPTION_KEY_ACTIVE (default v1).
 *
 * Procedimento de rotação:
 *   1. Gere a nova chave e adicione em ENCRYPTION_KEYS (ex.: v2=<hex>). Mantenha v1.
 *   2. Aponte ENCRYPTION_KEY_ACTIVE=v2 → novos valores passam a usar v2; os antigos
 *      (v1) continuam decifráveis porque v1 segue no registro.
 *   3. (Opcional) Rode um script de re-cifragem usando reencrypt() para migrar os
 *      registros v1 → v2 em background. Só depois disso é seguro aposentar v1.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

const parseHexKey = (raw, label) => {
  // Valida charset hex (não só o comprimento): um valor de 64 chars que não seja
  // hex puro (ex.: base64 colado por engano) faria Buffer.from(raw,'hex') truncar
  // silenciosamente e gerar uma chave errada/curta. Falhar cedo com mensagem clara.
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${label} inválida: deve ter 64 caracteres hex (32 bytes).`);
  }
  return Buffer.from(raw, 'hex');
};

// Registro lazy: as envs são lidas uma vez e cacheadas. _resetKeyRegistry()
// força releitura (usado em testes que trocam ENCRYPTION_* dinamicamente).
let _registry = null;

const buildRegistry = () => {
  const keys = new Map();

  // v1 = ENCRYPTION_KEY (obrigatória — mantém compatibilidade total).
  keys.set('v1', parseHexKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY'));

  // Chaves extras versionadas: "v2=<hex>;v3=<hex>"
  const extra = process.env.ENCRYPTION_KEYS;
  if (extra) {
    for (const entry of extra.split(';')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) {
        throw new Error(`ENCRYPTION_KEYS malformada perto de "${trimmed}" (use id=hex).`);
      }
      const id = trimmed.slice(0, eq).trim();
      const hex = trimmed.slice(eq + 1).trim();
      if (!/^v\d+$/.test(id)) {
        throw new Error(`ENCRYPTION_KEYS: id "${id}" inválido (use v2, v3, ...).`);
      }
      if (id === 'v1') {
        throw new Error('ENCRYPTION_KEYS: v1 é reservado para ENCRYPTION_KEY.');
      }
      if (keys.has(id)) {
        throw new Error(`ENCRYPTION_KEYS: id "${id}" duplicado.`);
      }
      keys.set(id, parseHexKey(hex, `ENCRYPTION_KEYS[${id}]`));
    }
  }

  const active = (process.env.ENCRYPTION_KEY_ACTIVE || 'v1').trim();
  if (!keys.has(active)) {
    throw new Error(`ENCRYPTION_KEY_ACTIVE="${active}" não existe no registro de chaves.`);
  }

  return { keys, active };
};

const registry = () => {
  if (!_registry) _registry = buildRegistry();
  return _registry;
};

/** Exposto p/ testes: força releitura das envs no próximo uso. */
export const _resetKeyRegistry = () => { _registry = null; };

const getKeyById = (id) => {
  const key = registry().keys.get(id);
  if (!key) {
    throw new Error(`Chave de criptografia "${id}" desconhecida — não é possível decifrar.`);
  }
  return key;
};

/** id da chave usada para cifrar novos valores (ex.: "v1", "v2"). */
export const getActiveKeyId = () => registry().active;

export const encrypt = (plaintext) => {
  if (!plaintext) return plaintext;
  const { active } = registry();
  const key = getKeyById(active);
  const iv = randomBytes(12); // 96 bits — tamanho padrão para GCM
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Prefixo de versão torna o ciphertext autodescritivo → rotação sem ambiguidade.
  return `${active}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decrypt = (ciphertext) => {
  if (!ciphertext) return ciphertext;
  // Suporte retroativo: se o valor não tem ":", assume texto claro
  // (migração gradual — usuários existentes antes da criptografia).
  if (!ciphertext.includes(':')) return ciphertext;

  const parts = ciphertext.split(':');
  let keyId, ivHex, authTagHex, dataHex;
  if (parts.length === 4 && /^v\d+$/.test(parts[0])) {
    // Formato versionado: "<keyId>:<iv>:<tag>:<data>" — keyId deve ser v1, v2, ...
    [keyId, ivHex, authTagHex, dataHex] = parts;
  } else if (parts.length === 3) {
    // Ciphertext legado (pré-S1.6) — sempre cifrado com v1.
    keyId = 'v1';
    [ivHex, authTagHex, dataHex] = parts;
  } else {
    return ciphertext; // formato não reconhecido → trata como claro
  }

  const key = getKeyById(keyId);
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};

/**
 * Re-cifra um valor com a CHAVE ATIVA atual (decrypt → encrypt). Usado por
 * scripts de rotação para migrar registros antigos (ex.: v1 → v2) sem expor o
 * valor em claro fora deste módulo. Tolera valores em claro e nulos.
 */
export const reencrypt = (ciphertext) => {
  if (!ciphertext) return ciphertext;
  const decrypted = decrypt(ciphertext);
  // decrypt() retorna o valor inalterado para formatos não reconhecidos — se isso
  // aconteceu num ciphertext (tem ':'), double-encrypt ao invés de silenciar.
  if (decrypted === ciphertext && ciphertext.includes(':')) {
    throw new Error('reencrypt: ciphertext com formato não reconhecido — impossível decifrar sem perda de dados.');
  }
  return encrypt(decrypted);
};

/**
 * Blind index — HMAC-SHA256 determinístico de um valor sensível.
 *
 * A criptografia AES-GCM usa IV aleatório, então o ciphertext de um mesmo CPF
 * é sempre diferente — inviável para busca de unicidade. O blind index resolve
 * isso: gera um hash estável (mesma entrada → mesma saída) que pode ser indexado
 * e consultado, sem revelar o valor original.
 *
 * IMPORTANTE: usa SEMPRE a chave v1 (ENCRYPTION_KEY), independentemente da chave
 * ativa de cifragem. O blind index precisa ser ESTÁVEL entre rotações para
 * garantir a unicidade do CPF (cpfHash) — se mudasse junto com a chave ativa,
 * registros antigos deixariam de casar e a checagem de unicidade quebraria.
 *
 * Usado p/ enforçar unicidade de CPF (campo cpfHash) sem armazenar o CPF em claro.
 */
export const blindIndex = (plaintext) => {
  if (!plaintext) return plaintext;
  const key = getKeyById('v1');
  return createHmac('sha256', key).update(String(plaintext)).digest('hex');
};
