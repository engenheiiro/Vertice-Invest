
import * as Sentry from '@sentry/node';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js';
import WalletSnapshot from '../models/WalletSnapshot.js';
import { buildWalletPayload } from './walletController.js';
import { safeFloat, safeCurrency, safeDiv, safeMult } from '../utils/mathUtils.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';

/**
 * (C4) Carteira pública — visão SOMENTE-LEITURA, sem autenticação, resolvida por
 * um token opt-in (Wallet.publicToken). Reusa buildWalletPayload (a mesma
 * matemática da carteira privada) e projeta um SUBCONJUNTO seguro:
 *   - composição por ativo (peso %) e alocação por classe (donut);
 *   - performance SÓ em % (cota TWRR normalizada — nunca expõe R$);
 *   - valores absolutos em R$ apenas se o dono optou (publicShowValues).
 * Nunca vaza userId, e-mail, custo, proventos ou métricas sensíveis.
 */

// Classe efetiva p/ o donut público: reserva (RF/CASH marcada) cai no balde CASH;
// ETF nacional (type 'ETF') conta dentro de Ações BR (STOCK); senão usa o type real.
// Espelha allocationBucket + fold de ETF do front (allocation.ts / AllocationChart).
const publicBucket = (asset) =>
    asset.isReserve ? 'CASH' : (asset.type === 'ETF' ? 'STOCK' : asset.type);

export const getPublicWallet = async (req, res, next) => {
    try {
        const { token } = req.params;
        // Token gerado com randomBytes(24) → ~32 chars base64url. Guard barato
        // contra varredura por strings curtas antes de tocar o banco.
        if (!token || typeof token !== 'string' || token.length < 16) {
            return next(AppError.notFound('Carteira pública não encontrada.'));
        }

        const wallet = await Wallet.findOne({ publicToken: token, isPublic: true })
            .select('_id user name publicShowValues').lean();
        if (!wallet) return next(AppError.notFound('Carteira pública não encontrada.'));

        const showValues = !!wallet.publicShowValues;
        const userId = String(wallet.user);
        const walletId = String(wallet._id);

        const [payload, owner, snaps] = await Promise.all([
            buildWalletPayload(userId, walletId),
            User.findById(userId).select('name').lean(),
            WalletSnapshot.find({ user: userId, wallet: walletId, totalEquity: { $gt: 1 } })
                .sort({ date: 1 }).select('date quotaPrice').lean(),
        ]);

        const equity = safeFloat(payload?.kpis?.totalEquity);
        const assets = Array.isArray(payload?.assets) ? payload.assets : [];

        // Composição por ativo (peso %), ordenada por peso desc. R$ só se liberado.
        const composition = assets
            .map((a) => {
                const value = safeFloat(a.totalValue);
                return {
                    ticker: a.ticker,
                    name: a.name,
                    type: a.type,
                    weightPct: equity > 0 ? safeMult(safeDiv(value, equity), 100) : 0,
                    ...(showValues ? { value: safeCurrency(value) } : {}),
                };
            })
            .sort((x, y) => y.weightPct - x.weightPct);

        // Alocação agregada por classe efetiva (donut).
        const bucketMap = {};
        for (const a of assets) {
            const b = publicBucket(a);
            bucketMap[b] = safeFloat(bucketMap[b]) + safeFloat(a.totalValue);
        }
        const allocation = Object.entries(bucketMap)
            .map(([cls, val]) => ({ class: cls, weightPct: equity > 0 ? safeMult(safeDiv(val, equity), 100) : 0 }))
            .sort((x, y) => y.weightPct - x.weightPct);

        // Curva de performance SÓ em % (cota TWRR reancorada a 0% no início).
        // Nunca carrega R$ — imune a aportes/resgates por construção da cota.
        const base = safeFloat(snaps[0]?.quotaPrice) || 100;
        const curve = base > 0
            ? snaps.map((s) => ({
                date: s.date,
                returnPct: safeMult(safeDiv(safeFloat(s.quotaPrice), base) - 1, 100),
            }))
            : [];

        // Só o primeiro nome do dono (link público por escolha explícita dele).
        const ownerFirstName = (owner?.name || '').trim().split(/\s+/)[0] || null;

        res.set('Cache-Control', 'public, max-age=60'); // teaser: cache de 1min
        res.json({
            wallet: { name: wallet.name, ownerFirstName },
            showValues,
            composition,
            allocation,
            performance: {
                totalReturnPct: safeFloat(payload?.kpis?.totalResultPercent),
                dayVariationPercent: safeFloat(payload?.kpis?.dayVariationPercent),
                curve,
            },
            kpis: showValues ? {
                totalEquity: safeCurrency(equity),
                totalInvested: safeCurrency(safeFloat(payload?.kpis?.totalInvested)),
                totalResult: safeCurrency(safeFloat(payload?.kpis?.totalResult)),
            } : null,
            meta: { updatedAt: new Date(), assetCount: assets.length },
        });
    } catch (error) {
        // (E5) Erros da rota pública ganham tag própria no Sentry — além do
        // handler global — para alerta/segmentação de uma superfície não-autenticada.
        if (process.env.SENTRY_DSN) {
            Sentry.withScope((scope) => {
                scope.setTag('route', 'public_wallet');
                Sentry.captureException(error);
            });
        }
        logger.error(`[PublicWallet] Falha ao resolver carteira pública: ${error.message}`);
        next(error);
    }
};
