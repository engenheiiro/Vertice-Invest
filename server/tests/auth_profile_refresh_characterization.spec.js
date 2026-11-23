import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Caracterização de `updateProfile` e `refreshToken` (authController), gravada no
// código ANTERIOR à divisão das duas funções em partes. Trava o que importa para
// a segurança: quais campos chegam ao $set/$unset do User (plano, papel, e-mail,
// senha e sessionVersion nunca), validações e códigos de status, e na renovação
// de sessão a rotação/revogação do refresh token, a janela de graça, os cookies,
// o payload do access token (sv) e o que é gravado/apagado em RefreshToken.
// Sem banco: modelos, criptografia, CSRF e e-mail mockados; jwt é o real.

process.env.JWT_SECRET = 'char-secret';
process.env.JWT_REFRESH_SECRET = 'char-refresh-secret';
process.env.CLIENT_URL = 'https://verticeinvest.com.br';

vi.mock('../models/User.js', () => ({
  default: { findOne: vi.fn(), findById: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
vi.mock('../models/RefreshToken.js', () => ({
  default: {
    findOne: vi.fn(), findOneAndDelete: vi.fn(), findByIdAndDelete: vi.fn(),
    create: vi.fn(), deleteMany: vi.fn(), verifyExpiration: vi.fn(),
  },
}));
vi.mock('../models/AuditLog.js', () => ({ default: { create: vi.fn(() => Promise.resolve()) } }));
vi.mock('../services/emailService.js', () => ({ sendResetPasswordEmail: vi.fn() }));
vi.mock('../config/logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));
vi.mock('../utils/userCache.js', () => ({ invalidateUser: vi.fn() }));
vi.mock('../utils/encryption.js', () => ({
  encrypt: (s) => `enc(${s})`, decrypt: (s) => `dec(${s})`, blindIndex: (s) => `bi(${s})`,
}));
vi.mock('../middleware/csrf.js', () => ({ issueCsrfToken: vi.fn(), clearCsrfToken: vi.fn() }));

const jwt = (await import('jsonwebtoken')).default;
const User = (await import('../models/User.js')).default;
const RefreshToken = (await import('../models/RefreshToken.js')).default;
const AuditLog = (await import('../models/AuditLog.js')).default;
const { invalidateUser } = await import('../utils/userCache.js');
const { issueCsrfToken } = await import('../middleware/csrf.js');
const { updateProfile, refreshToken } = await import('../controllers/authController.js');

const NOW = new Date('2026-11-23T12:00:00Z');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Serialização estável: chaves ordenadas, undefined/NaN/±Infinity/-0/Date explícitos.
const norm = (v) => {
  if (v === undefined) return '__undef';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return '__NaN';
    if (!Number.isFinite(v)) return v > 0 ? '__Inf' : '__-Inf';
    if (Object.is(v, -0)) return '__-0';
    return v;
  }
  if (typeof v === 'function') return '__fn';
  if (v instanceof Date) return `__date(${v.toISOString()})`;
  if (v instanceof Error) return { __error: v.name, message: v.message };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = norm(v[k]);
    return out;
  }
  return v;
};
const stable = (v) => JSON.stringify(norm(v));
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const mockRes = () => {
  const res = { statusCode: 200, body: null, cookies: [] };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.cookie = (name, value, opts) => { res.cookies.push({ name, value, opts }); return res; };
  return res;
};

const decodeTokens = (v) => {
  if (typeof v !== 'string' || v.split('.').length !== 3) return v;
  return { jwt: v, payload: jwt.decode(v) };
};

const ALL_MOCKS = () => ({
  'User.findOne': User.findOne, 'User.findById': User.findById, 'User.findByIdAndUpdate': User.findByIdAndUpdate,
  'RT.findOne': RefreshToken.findOne, 'RT.findOneAndDelete': RefreshToken.findOneAndDelete,
  'RT.findByIdAndDelete': RefreshToken.findByIdAndDelete, 'RT.create': RefreshToken.create,
  'RT.deleteMany': RefreshToken.deleteMany, 'RT.verifyExpiration': RefreshToken.verifyExpiration,
  'Audit.create': AuditLog.create, invalidateUser, issueCsrfToken,
});

const collectCalls = () => {
  const out = {};
  for (const [name, fn] of Object.entries(ALL_MOCKS())) {
    if (fn.mock.calls.length) out[name] = fn.mock.calls.map((args) => args.map((a) => (
      name === 'issueCsrfToken' ? '__req/res' : a
    )));
  }
  return out;
};

const resetMocks = () => {
  for (const fn of Object.values(ALL_MOCKS())) fn.mockReset();
  AuditLog.create.mockImplementation(() => Promise.resolve());
};

const outcome = (res, next, extra = {}) => ({
  status: res.statusCode,
  body: res.body && typeof res.body === 'object'
    ? Object.fromEntries(Object.entries(res.body).map(([k, v]) => [k, decodeTokens(v)]))
    : res.body,
  cookies: res.cookies.map((c) => ({ ...c, value: decodeTokens(c.value) })),
  next: next.mock.calls.map((args) => args.map((e) => (e instanceof Error ? { name: e.name, message: e.message } : e))),
  calls: collectCalls(),
  ...extra,
});

// ---------------------------------------------------------------- updateProfile

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const UNSET = Symbol('unset');

const POOLS = {
  name: [UNSET, 'Ana Souza', '', 'X'],
  cpf: [UNSET, '', '529.982.247-25', '52998224725', '12345678900', '111.111.111-11', 'abc', null, 123],
  phone: [UNSET, '', '11999990000'],
  occupation: [UNSET, '', 'Engenheira'],
  bannerColor: [UNSET, '', null, 'ocean', 'gold', 'graphite', 'pink', 123],
  brokerage: [UNSET, '', '  XP  ', 'a'.repeat(80), 'a'.repeat(81), 42, null],
  cep: [UNSET, '', ' 01001-000 ', 'x'.repeat(120), 'x'.repeat(121), 5],
  street: [UNSET, '', 'Rua A', 'y'.repeat(121)],
  neighborhood: [UNSET, '', 'Centro', 7],
  city: [UNSET, '', 'São Paulo', 'z'.repeat(121)],
  state: [UNSET, '', 'SP', null],
  birthDate: [UNSET, '', '1990-05-10', '1990-02-30', '2030-01-01', '1900-01-01', '1906-11-23', '1906-11-24',
    '10/05/1990', 19900510, '2026-11-23', '2026-11-24', ' 1985-01-31 ', null],
  salary: [UNSET, null, '', '5000', 5000.5, -1, 'abc', 1e13, 0, '1e12', Infinity, '  7  ', true],
};
const FORBIDDEN = {
  plan: 'BLACK', role: 'ADMIN', email: 'novo@x.com', password: 'hack', sessionVersion: 99,
  mfaEnabled: false, subscriptionStatus: 'ACTIVE', validUntil: '2099-01-01', avatar: 'data:x',
  cpfHash: 'forjado', isActive: true, resetPasswordToken: 't', activeWalletId: 'w9',
};

const STORED_USER = {
  _id: 'u1', name: 'Ana', email: 'ana@x.com', plan: 'PRO', role: 'USER', subscriptionStatus: 'ACTIVE',
  validUntil: new Date('2027-01-01T00:00:00Z'), hasSeenTutorial: true, cpf: 'c1', phone: '119', occupation: 'dev',
  bannerColor: 'ocean', marketingOptIn: false, mfaEnabled: 1, avatar: 'data:a', brokerage: 'XP', cep: '01001',
  street: 'R', neighborhood: 'N', city: 'C', state: 'SP', birthDate: 'b1', salary: 's1', password: 'hash',
  sessionVersion: 3, mfaSecret: 'segredo',
};

function buildProfileScenario(seed) {
  const r = mulberry32(seed);
  const body = {};
  for (const [key, pool] of Object.entries(POOLS)) {
    if (r() < 0.45) continue;
    const v = pick(r, pool);
    if (v !== UNSET) body[key] = v;
  }
  for (const [key, v] of Object.entries(FORBIDDEN)) if (r() < 0.12) body[key] = v;
  return {
    body,
    cpfOwner: pick(r, [null, { _id: 'u1' }, { _id: 'u2' }, 'reject']),
    updated: pick(r, ['stored', 'stored', 'stored', 'stored', 'empty', null, 'reject']),
  };
}

async function runProfile(sc) {
  resetMocks();
  User.findOne.mockImplementation(() => ({
    select: () => (sc.cpfOwner === 'reject'
      ? Promise.reject(new Error('mongo fora (findOne)'))
      : Promise.resolve(sc.cpfOwner && { _id: { toString: () => sc.cpfOwner._id } })),
  }));
  User.findByIdAndUpdate.mockImplementation(() => {
    if (sc.updated === 'reject') return Promise.reject(new Error('mongo fora (update)'));
    if (sc.updated === 'stored') return Promise.resolve({ ...STORED_USER });
    if (sc.updated === 'empty') return Promise.resolve({ _id: 'u1' });
    return Promise.resolve(null);
  });
  const res = mockRes();
  const next = vi.fn();
  await updateProfile({ user: { id: 'u1' }, body: sc.body, headers: {}, socket: {} }, res, next);
  return outcome(res, next);
}

// ---------------------------------------------------------------- refreshToken

const signRefresh = (payload, secret = process.env.JWT_REFRESH_SECRET, opts = { expiresIn: '7d' }) =>
  jwt.sign(payload, secret, opts);

function buildRefreshScenario(seed) {
  const r = mulberry32(seed * 7919 + 13);
  const uid = `user-${seed}`;
  const cookieKind = pick(r, ['valid', 'valid', 'valid', 'valid', 'noId', 'wrongSecret', 'garbage', 'expired']);
  const user = pick(r, [
    { _id: uid, email: `${uid}@x.com`, plan: 'PRO', role: 'USER', sessionVersion: 2, isActive: true },
    { _id: uid, email: `${uid}@x.com`, plan: 'GUEST', role: 'ADMIN' },
    { _id: uid, email: `${uid}@x.com`, plan: 'ELITE', role: 'USER', isActive: false, sessionVersion: 5 },
    null,
    'reject',
  ]);
  return {
    uid,
    cookieKind,
    cookies: pick(r, ['cookie', 'cookie', 'cookie', 'cookie', 'cookie', 'none', 'empty', 'blank']),
    // Rotação anterior do MESMO cookie (registra a janela de graça) e por quem.
    prime: pick(r, [null, null, 'same', 'same', 'other']),
    advanceMs: pick(r, [0, 0, 5_000, 14_000, 16_000, 60_000]),
    tokenInDb: pick(r, ['doc', 'doc', 'doc', null, null, 'reject']),
    expired: r() < 0.15,
    user,
    claimed: pick(r, ['doc', 'doc', 'doc', null]),
    create: r() < 0.1 ? 'reject' : 'ok',
    req: { ip: pick(r, ['10.0.0.1', undefined, ['10.0.0.2', '10.0.0.3']]), ua: pick(r, ['UA/1', undefined]) },
  };
}

const cookieValueFor = (sc) => {
  switch (sc.cookieKind) {
    case 'valid': return signRefresh({ id: sc.uid, n: sc.uid });
    case 'noId': return signRefresh({ sub: sc.uid });
    case 'wrongSecret': return signRefresh({ id: sc.uid }, 'outro-segredo');
    case 'expired': return signRefresh({ id: sc.uid, exp: Math.floor(NOW.getTime() / 1000) - 10 }, undefined, {});
    default: return `lixo-${sc.uid}`;
  }
};

const reqFor = (sc, cookies) => ({
  cookies, ip: sc.req.ip, headers: sc.req.ua ? { 'user-agent': sc.req.ua } : {}, socket: { remoteAddress: '127.9.9.9' },
});

async function primeRotation(sc, cookie) {
  resetMocks();
  const owner = sc.prime === 'same' ? sc.uid : `${sc.uid}-outro`;
  RefreshToken.findOne.mockResolvedValue({ _id: `rt-prime-${sc.uid}`, user: owner });
  RefreshToken.verifyExpiration.mockReturnValue(false);
  User.findById.mockResolvedValue({ _id: owner, email: `${owner}@x.com`, plan: 'PRO', role: 'USER', sessionVersion: 1 });
  RefreshToken.findOneAndDelete.mockResolvedValue({ _id: `rt-prime-${sc.uid}` });
  RefreshToken.create.mockResolvedValue({});
  const res = mockRes();
  const next = vi.fn();
  await refreshToken(reqFor(sc, { jwt: cookie }), res, next);
  return outcome(res, next);
}

async function runRefresh(sc) {
  vi.setSystemTime(NOW);
  const cookie = cookieValueFor(sc);
  const primed = sc.prime ? await primeRotation(sc, cookie) : null;
  vi.setSystemTime(new Date(NOW.getTime() + sc.advanceMs));

  resetMocks();
  RefreshToken.findOne.mockImplementation(() => {
    if (sc.tokenInDb === 'reject') return Promise.reject(new Error('mongo fora (rt)'));
    return Promise.resolve(sc.tokenInDb ? { _id: `rt-${sc.uid}`, user: sc.uid } : null);
  });
  RefreshToken.verifyExpiration.mockReturnValue(sc.expired);
  User.findById.mockImplementation((id) => {
    if (sc.user === 'reject') return Promise.reject(new Error('mongo fora (user)'));
    if (!sc.user) return Promise.resolve(null);
    return Promise.resolve({ ...sc.user, _id: id });
  });
  RefreshToken.findOneAndDelete.mockResolvedValue(sc.claimed ? { _id: `rt-${sc.uid}` } : null);
  RefreshToken.findByIdAndDelete.mockResolvedValue({});
  RefreshToken.deleteMany.mockResolvedValue({});
  RefreshToken.create.mockImplementation(() => (
    sc.create === 'reject' ? Promise.reject(new Error('mongo fora (create)')) : Promise.resolve({})
  ));

  const cookies = { cookie: { jwt: cookie }, none: undefined, empty: {}, blank: { jwt: '' } }[sc.cookies];
  const res = mockRes();
  const next = vi.fn();
  await refreshToken(reqFor(sc, cookies), res, next);
  return outcome(res, next, { primed });
}

// ---------------------------------------------------------------- execução

const PROFILE_SCENARIOS = 400;
const REFRESH_SCENARIOS = 500;

const profileResults = [];
const refreshResults = [];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  for (let seed = 1; seed <= PROFILE_SCENARIOS; seed++) {
    const sc = buildProfileScenario(seed);
    profileResults.push({ seed, sc, out: await runProfile(sc) });
  }
  for (let seed = 1; seed <= REFRESH_SCENARIOS; seed++) {
    const sc = buildRefreshScenario(seed);
    refreshResults.push({ seed, sc, out: await runRefresh(sc) });
  }
}, 60_000);

afterAll(() => {
  vi.useRealTimers();
});

describe('caracterização — updateProfile', () => {
  it('hash por cenário', () => {
    const hashes = Object.fromEntries(profileResults.map(({ seed, out }) => [seed, sha(stable(out))]));
    expect(hashes).toMatchSnapshot();
  });

  it('cenários legíveis', () => {
    const sample = profileResults.filter(({ seed }) => seed % 50 === 1)
      .map(({ seed, sc, out }) => ({ seed, body: norm(sc.body), cpfOwner: sc.cpfOwner, updated: sc.updated, out: norm(out) }));
    expect(sample).toMatchSnapshot();
  });

  it('nenhum campo protegido chega ao banco', () => {
    for (const { out } of profileResults) {
      for (const [, ops] of out.calls['User.findByIdAndUpdate'] ?? []) {
        const keys = [...Object.keys(ops.$set ?? {}), ...Object.keys(ops.$unset ?? {})];
        for (const k of keys) expect(Object.keys(FORBIDDEN).filter((f) => f !== 'cpfHash')).not.toContain(k);
      }
    }
  });

  it('a matriz cobre todos os desfechos', () => {
    const statuses = new Set(profileResults.map(({ out }) => (out.next.length ? 'next' : out.status)));
    expect([...statuses].sort()).toEqual([200, 400, 409, 'next'].sort());
  });
});

describe('caracterização — refreshToken', () => {
  it('hash por cenário', () => {
    const hashes = Object.fromEntries(refreshResults.map(({ seed, out }) => [seed, sha(stable(out))]));
    expect(hashes).toMatchSnapshot();
  });

  it('cenários legíveis', () => {
    const sample = refreshResults.filter(({ seed }) => seed % 20 === 3)
      .map(({ seed, sc, out }) => ({ seed, sc: norm(sc), out: norm(out) }));
    expect(sample).toMatchSnapshot();
  });

  it('a matriz cobre todos os desfechos', () => {
    const statuses = new Set(refreshResults.map(({ out }) => (out.next.length ? 'next' : out.status)));
    expect([...statuses].sort()).toEqual([200, 401, 404, 'next'].sort());
  });
});
