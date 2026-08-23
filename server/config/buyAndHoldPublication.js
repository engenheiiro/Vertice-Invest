/**
 * Configuração da CAMADA DE PUBLICAÇÃO da estratégia âncora `BUY_AND_HOLD`.
 *
 * Data-only e congelada; a lógica vive em `server/utils/anchorHysteresis.js`
 * (função pura) e em `server/services/anchorPublicationService.js` (I/O).
 *
 * Distinta da estratégia legada `BUY_HOLD` (Research semanal de 3 perfis), que
 * NÃO passa por nada deste módulo: outra `strategy`, outro ponteiro publicado,
 * outro contrato de ranking.
 */

import { BUY_THRESHOLD } from './financialConstants.js';

export const ANCHOR_STRATEGY = 'BUY_AND_HOLD';

/** Perfil único da lista âncora. Ela não tem os três perfis do semanal. */
export const ANCHOR_RISK_PROFILE = 'ANCHOR';

/** Classes publicadas pela estratégia âncora, na ordem em que o cron as roda. */
export const ANCHOR_ASSET_CLASSES = Object.freeze(['STOCK', 'FII']);

/**
 * HISTERESE — o motivo pelo qual esta camada existe.
 *
 * O limiar de 70 é um degrau, e a lista âncora é fina demais para um degrau.
 * Medição de 22/08/2026 sobre os 17 elegíveis de ações: 4 nomes (24% do
 * universo) ficam a ±5 pontos do limiar, e o BRSR6 trocou de COMPRAR para
 * AGUARDAR entre duas rodadas da MESMA sessão caindo de 70 para 69 — um ponto,
 * sem que nada tivesse acontecido com o banco.
 *
 * Uma lista que gira por um ponto é um screener com outro nome, que é
 * exatamente o defeito V-01 do estudo de maturidade (o Brasil 10 girou 34
 * tickers distintos em 40 publicações de 90 dias). A tese âncora é carregar por
 * décadas; a lista precisa de inércia compatível.
 *
 * Regra: **entra** em COMPRAR com score >= `entryScore`; **permanece** enquanto
 * score >= `holdScore`. A faixa entre os dois é zona morta: quem já está fica,
 * quem está de fora não entra.
 *
 * A histerese afrouxa APENAS o limiar de score. Ela nunca mantém em COMPRAR um
 * ativo travado por motivo substantivo (preço acima do justo, distribuição não
 * coberta pelo FFO, teto de composição da carteira, saída do portão): esses são
 * fatos novos sobre o ativo, não oscilação de medição.
 *
 * `holdScore` = 62 dá 8 pontos de banda — folga confortável para o ruído de
 * medição observado (1 a 5 pontos) sem segurar uma deterioração real.
 */
export const ANCHOR_HYSTERESIS = Object.freeze({
  entryScore: BUY_THRESHOLD,
  holdScore: 62,
});

/**
 * Gate de qualidade da publicação âncora. Espelha o do auto-publish semanal
 * (`validateAutoPublish`), mas com números próprios: a lista âncora é
 * deliberadamente curta (6 ações e 3 FIIs em 22/08/2026), então exigir 5
 * COMPRAR reprovaria uma lista saudável.
 *
 * `minEligible` cobre o caso que realmente importa: sync quebrado ou base
 * degradada esvaziam o universo elegível, e uma lista âncora vazia (ou com dois
 * nomes) publicada às cegas é pior que nenhuma publicação.
 */
export const ANCHOR_PUBLICATION_GATE = Object.freeze({
  minEligible: 10,
  minAnalyzed: 50,
});

/**
 * Ressalva exibida na página e persistida junto do relatório. A lista usa termos
 * fortes (COMPRAR / âncora / carregar por décadas); a ressalva precisa viajar
 * com o conteúdo, não morar só nos Termos.
 */
export const ANCHOR_DISCLAIMER = 'Conteúdo informativo e educacional gerado por análise quantitativa; '
  + 'não constitui recomendação individualizada de investimento. '
  + 'Investimentos envolvem risco de perda de capital.';
