/**
 * S1.6 — criptografia em repouso com chaves versionadas.
 * Cobre: round-trip básico, compatibilidade com ciphertext legado (3 partes),
 * texto em claro legado, estabilidade do blind index e — o ponto central —
 * rotação de chave (v1 → v2) sem perder a capacidade de decifrar valores v1.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createCipheriv, randomBytes } from 'crypto';

const KEY_V1 = 'a'.repeat(64); // 32 bytes hex
const KEY_V2 = 'b'.repeat(64);

// Helper: cifra no formato LEGADO (3 partes, sem prefixo de versão) com a v1.
const legacyEncryptV1 = (plaintext) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY_V1, 'hex'), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

let enc;
const load = async () => {
  enc = await import('../utils/encryption.js');
  enc._resetKeyRegistry();
};

beforeEach(async () => {
  process.env.ENCRYPTION_KEY = KEY_V1;
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_KEY_ACTIVE;
  await load();
});

afterEach(() => {
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_KEY_ACTIVE;
});

describe('encryption — round-trip e formato', () => {
  it('cifra e decifra (round-trip) com prefixo de versão ativa', () => {
    const ct = enc.encrypt('segredo-totp');
    expect(ct.startsWith('v1:')).toBe(true);
    expect(ct.split(':')).toHaveLength(4);
    expect(enc.decrypt(ct)).toBe('segredo-totp');
  });

  it('valores vazios/nulos passam direto (encrypt e decrypt)', () => {
    expect(enc.encrypt('')).toBe('');
    expect(enc.encrypt(null)).toBe(null);
    expect(enc.decrypt('')).toBe('');
    expect(enc.decrypt(undefined)).toBe(undefined);
  });

  it('texto em claro legado (sem ":") é devolvido como está', () => {
    expect(enc.decrypt('texto-claro-antigo')).toBe('texto-claro-antigo');
  });

  it('decifra ciphertext legado de 3 partes (pré-versionamento) com v1', () => {
    const legacy = legacyEncryptV1('cpf-12345678900');
    expect(legacy.split(':')).toHaveLength(3);
    expect(enc.decrypt(legacy)).toBe('cpf-12345678900');
  });

  it('getActiveKeyId default é v1', () => {
    expect(enc.getActiveKeyId()).toBe('v1');
  });
});

describe('encryption — rotação de chaves (S1.6)', () => {
  it('com v2 ativa, cifra com v2 mas ainda decifra valores v1', async () => {
    // Valor cifrado ANTES da rotação (v1).
    const beforeRotation = enc.encrypt('valor-antigo');
    expect(beforeRotation.startsWith('v1:')).toBe(true);

    // Rotaciona: adiciona v2 e torna-a ativa.
    process.env.ENCRYPTION_KEYS = `v2=${KEY_V2}`;
    process.env.ENCRYPTION_KEY_ACTIVE = 'v2';
    await load();

    const afterRotation = enc.encrypt('valor-novo');
    expect(afterRotation.startsWith('v2:')).toBe(true);

    // Os dois continuam decifráveis (v1 segue no registro).
    expect(enc.decrypt(beforeRotation)).toBe('valor-antigo');
    expect(enc.decrypt(afterRotation)).toBe('valor-novo');
  });

  it('reencrypt migra um ciphertext v1 para a chave ativa (v2)', async () => {
    const v1ct = enc.encrypt('migrar-me');

    process.env.ENCRYPTION_KEYS = `v2=${KEY_V2}`;
    process.env.ENCRYPTION_KEY_ACTIVE = 'v2';
    await load();

    const migrated = enc.reencrypt(v1ct);
    expect(migrated.startsWith('v2:')).toBe(true);
    expect(enc.decrypt(migrated)).toBe('migrar-me');
  });

  it('blind index é estável e independe da chave ativa (unicidade de CPF)', async () => {
    const cpf = '52998224725';
    const idxBefore = enc.blindIndex(cpf);

    // Mesmo rotacionando a chave ativa, o blind index não pode mudar.
    process.env.ENCRYPTION_KEYS = `v2=${KEY_V2}`;
    process.env.ENCRYPTION_KEY_ACTIVE = 'v2';
    await load();

    expect(enc.blindIndex(cpf)).toBe(idxBefore);
  });
});

describe('encryption — validação de configuração', () => {
  it('ENCRYPTION_KEY ausente/curta lança erro', async () => {
    process.env.ENCRYPTION_KEY = 'curta';
    await load();
    expect(() => enc.encrypt('x')).toThrow(/ENCRYPTION_KEY inválida/);
  });

  it('ENCRYPTION_KEY_ACTIVE inexistente lança erro', async () => {
    process.env.ENCRYPTION_KEY = KEY_V1;
    process.env.ENCRYPTION_KEY_ACTIVE = 'v9';
    await load();
    expect(() => enc.encrypt('x')).toThrow(/não existe no registro/);
  });

  it('ENCRYPTION_KEYS tentando redefinir v1 é rejeitada', async () => {
    process.env.ENCRYPTION_KEY = KEY_V1;
    process.env.ENCRYPTION_KEYS = `v1=${KEY_V2}`;
    await load();
    expect(() => enc.encrypt('x')).toThrow(/v1 é reservado/);
  });

  it('ENCRYPTION_KEYS com id inválido é rejeitada', async () => {
    process.env.ENCRYPTION_KEY = KEY_V1;
    process.env.ENCRYPTION_KEYS = `chave2=${KEY_V2}`;
    await load();
    expect(() => enc.encrypt('x')).toThrow(/id "chave2" inválido/);
  });
});
