// Ferramentas dos testes de caracterização: PRNG semeado e serialização canônica.
// A serialização ordena chaves e torna explícitos os valores que o JSON perde
// (-0, NaN, Infinity, undefined, Date, Map, Set, função), para que o hash mude
// sempre que a saída muda.
import { createHash } from 'node:crypto';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canonNumber = (v) => {
  if (Object.is(v, -0)) return '-0';
  if (Number.isNaN(v)) return 'NaN';
  if (!Number.isFinite(v)) return v > 0 ? 'Infinity' : '-Infinity';
  return v;
};

const canonObject = (v) => {
  if (v instanceof Date) return { $date: Number.isFinite(v.getTime()) ? v.toISOString() : 'Invalid Date' };
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [canon(k), canon(x)]) };
  if (v instanceof Set) return { $set: [...v].map(canon) };
  if (Array.isArray(v)) return v.map(canon);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
  return out;
};

export function canon(v) {
  if (v === undefined) return '$undefined';
  if (typeof v === 'number') return canonNumber(v);
  if (typeof v === 'function') return '$function';
  if (v === null || typeof v !== 'object') return v;
  return canonObject(v);
}

export const hash16 = (value) => createHash('sha256').update(JSON.stringify(canon(value))).digest('hex').slice(0, 16);
