/**
 * Cache de logos (AssetLogo) e notificações.
 *
 * logoService: a CDN é chamada só na primeira vez; 404 e resposta que não é
 * imagem viram cache negativo (MISSING) sem barulho, e o MISSING só é
 * re-tentado depois de 7 dias. Falha de infra também vira MISSING, e circuito
 * aberto não polui o log. axios e o banco são falsos; retry/breaker são
 * substituídos por passagem direta para o teste não dormir.
 *
 * notificationService: falha ao gravar nunca derruba quem chamou.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    get: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    exec: vi.fn((fn) => fn()),
    notifCreate: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('axios', () => ({ default: { get: h.get } }));
vi.mock('../models/AssetLogo.js', () => ({ default: { findOne: h.findOne, findOneAndUpdate: h.findOneAndUpdate } }));
vi.mock('../models/Notification.js', () => ({ default: { create: h.notifCreate } }));
vi.mock('../config/logger.js', () => ({ default: h.log }));
vi.mock('../utils/resilience.js', () => ({
    withRetry: (fn) => fn(),
    createCircuitBreaker: () => ({ exec: (fn) => h.exec(fn) }),
}));

const { getOrFetch } = await import('../services/logoService.js');
const { createNotification, createBroadcast } = await import('../services/notificationService.js');

const NOW = new Date('2026-11-22T12:00:00Z');
const SVG = Buffer.from('<svg/>');

const resposta = (status, contentType = 'image/svg+xml', data = SVG) => ({ status, headers: { 'content-type': contentType }, data });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    h.get.mockReset();
    h.findOne.mockReset().mockResolvedValue(null);
    h.findOneAndUpdate.mockReset().mockResolvedValue({});
    h.exec.mockReset().mockImplementation((fn) => fn());
    h.notifCreate.mockReset();
    Object.values(h.log).forEach((f) => f.mockClear());
});

afterEach(() => {
    vi.useRealTimers();
});

describe('origem da logo por tipo', () => {
    it.each([
        ['petr4 ', 'STOCK', 'https://icons.brapi.dev/icons/PETR4.svg', 'STOCK'],
        ['btc-usd', 'CRYPTO', 'https://cdn.jsdelivr.net/npm/cryptocurrency-icons@latest/svg/color/btc.svg', 'CRYPTO'],
        ['AAPL', 'STOCK_US', 'https://assets.parqet.com/logos/symbol/AAPL', 'STOCK_US'],
        ['VALE3', 'ETF_DESCONHECIDO', 'https://icons.brapi.dev/icons/VALE3.svg', 'STOCK'],
    ])('%s (%s) busca em %s e grava como %s', async (ticker, type, url, cacheType) => {
        h.get.mockResolvedValue(resposta(200));
        const r = await getOrFetch(ticker, type);
        expect(h.get.mock.calls[0][0]).toBe(url);
        expect(r).toEqual({ data: SVG, contentType: 'image/svg+xml', bytes: SVG.length });
        const [filtro, update] = h.findOneAndUpdate.mock.calls[0];
        expect(filtro.type).toBe(cacheType);
        expect(update).toMatchObject({ status: 'OK', bytes: SVG.length, source: url, fetchedAt: NOW });
    });

    it.each(['FII', 'FIXED_INCOME', 'CASH'])('%s não tem fonte: nem cache nem CDN', async (type) => {
        expect(await getOrFetch('HGLG11', type)).toBeNull();
        expect(h.findOne).not.toHaveBeenCalled();
        expect(h.get).not.toHaveBeenCalled();
    });

    it('ticker vazio devolve null sem consultar nada', async () => {
        expect(await getOrFetch('  ', 'STOCK')).toBeNull();
        expect(await getOrFetch(undefined, 'STOCK')).toBeNull();
        expect(h.findOne).not.toHaveBeenCalled();
    });
});

describe('cache', () => {
    it('logo OK em cache é servida sem tocar na CDN', async () => {
        h.findOne.mockResolvedValue({ status: 'OK', data: SVG, contentType: 'image/svg+xml', bytes: 6 });
        expect(await getOrFetch('PETR4', 'STOCK')).toEqual({ data: SVG, contentType: 'image/svg+xml', bytes: 6 });
        expect(h.get).not.toHaveBeenCalled();
    });

    it('MISSING fresco (< 7 dias) não rebate a CDN', async () => {
        h.findOne.mockResolvedValue({ status: 'MISSING', fetchedAt: new Date('2026-11-20T12:00:00Z') });
        expect(await getOrFetch('XYZW3', 'STOCK')).toBeNull();
        expect(h.get).not.toHaveBeenCalled();
    });

    it('MISSING vencido (> 7 dias) tenta de novo e grava OK se a logo passou a existir', async () => {
        h.findOne.mockResolvedValue({ status: 'MISSING', fetchedAt: new Date('2026-11-10T12:00:00Z') });
        h.get.mockResolvedValue(resposta(200, 'image/png; charset=binary'));
        const r = await getOrFetch('XYZW3', 'STOCK');
        expect(r.contentType).toBe('image/png');
        expect(h.findOneAndUpdate.mock.calls[0][1].status).toBe('OK');
    });
});

describe('respostas da CDN', () => {
    const missingGravado = () => {
        const [, update, opts] = h.findOneAndUpdate.mock.calls[0];
        expect(update).toMatchObject({ status: 'MISSING', data: null, bytes: 0, fetchedAt: NOW });
        expect(opts).toEqual({ upsert: true, new: true });
    };

    it('404 vira cache negativo sem log', async () => {
        h.get.mockResolvedValue(resposta(404));
        expect(await getOrFetch('NOPE3', 'STOCK')).toBeNull();
        missingGravado();
        expect(h.log.warn).not.toHaveBeenCalled();
    });

    it('conteúdo que não é imagem vira MISSING', async () => {
        h.get.mockResolvedValue(resposta(200, 'text/html'));
        expect(await getOrFetch('NOPE3', 'STOCK')).toBeNull();
        missingGravado();
    });

    it('imagem vazia ou acima de 256KB vira MISSING', async () => {
        h.get.mockResolvedValueOnce(resposta(200, 'image/svg+xml', Buffer.alloc(0)));
        expect(await getOrFetch('A', 'STOCK')).toBeNull();
        h.get.mockResolvedValueOnce(resposta(200, 'image/png', Buffer.alloc(256 * 1024 + 1)));
        expect(await getOrFetch('B', 'STOCK')).toBeNull();
        expect(h.findOneAndUpdate.mock.calls.every(([, u]) => u.status === 'MISSING')).toBe(true);
    });

    it('5xx é falha de infra: MISSING e aviso no log', async () => {
        h.get.mockResolvedValue(resposta(503));
        expect(await getOrFetch('PETR4', 'STOCK')).toBeNull();
        missingGravado();
        expect(h.log.warn).toHaveBeenCalledWith(expect.stringContaining('Logo HTTP 503'));
    });

    it('circuito aberto vira MISSING sem poluir o log', async () => {
        h.exec.mockRejectedValue(Object.assign(new Error('aberto'), { code: 'ERR_CIRCUIT_OPEN' }));
        expect(await getOrFetch('PETR4', 'STOCK')).toBeNull();
        missingGravado();
        expect(h.log.warn).not.toHaveBeenCalled();
    });

    it('a chamada leva teto de tempo, de tamanho e trata o status por conta própria', async () => {
        h.get.mockResolvedValue(resposta(200));
        await getOrFetch('PETR4', 'STOCK');
        const opts = h.get.mock.calls[0][1];
        expect(opts).toMatchObject({ responseType: 'arraybuffer', timeout: 8000, maxContentLength: 256 * 1024 });
        expect(opts.validateStatus(500)).toBe(true);
    });
});

describe('notificationService', () => {
    it('createNotification grava com o link e devolve o documento', async () => {
        h.notifCreate.mockResolvedValue({ _id: 'n1' });
        const doc = await createNotification({ user: 'u1', type: 'SUPPORT_REPLY', title: 't', message: 'm', link: '/suporte' });
        expect(doc).toEqual({ _id: 'n1' });
        expect(h.notifCreate).toHaveBeenCalledWith({
            user: 'u1', type: 'SUPPORT_REPLY', title: 't', message: 'm', relatedAssetClass: undefined, link: '/suporte',
        });
    });

    it('broadcast vai sem usuário', async () => {
        h.notifCreate.mockResolvedValue({ _id: 'b1' });
        await createBroadcast({ type: 'RANKING', title: 't', message: 'm', relatedAssetClass: 'STOCK' });
        expect(h.notifCreate).toHaveBeenCalledWith({ user: null, type: 'RANKING', title: 't', message: 'm', relatedAssetClass: 'STOCK' });
    });

    it('falha no banco devolve null nos dois caminhos, sem lançar', async () => {
        h.notifCreate.mockRejectedValue(new Error('mongo fora'));
        expect(await createNotification({ user: 'u1', type: 'X', title: 't', message: 'm' })).toBeNull();
        expect(await createBroadcast({ type: 'X', title: 't', message: 'm' })).toBeNull();
        expect(h.log.error).toHaveBeenCalledTimes(2);
    });
});
