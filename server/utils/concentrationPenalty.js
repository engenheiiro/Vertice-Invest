/**
 * Tabela de penalidade de concentração — fonte ÚNICA.
 *
 * Extraída de `portfolioEngine.applyConcentrationPenalty`, que continua sendo
 * quem a aplica no draft. A retenção de assento (`utils/weeklyRetention.js`)
 * precisa da MESMA tabela para pontuar um incumbente readmitido: ele entra por
 * último no balde e, sem a dedução, um 4º banco readmitido publicaria 71/COMPRAR
 * enquanto o 3º banco sorteado pelo draft publicaria 66/AGUARDAR — mesma lista,
 * duas réguas. Duplicar os números em dois arquivos reintroduziria a divergência
 * na primeira vez que um deles fosse ajustado.
 *
 * Função PURA, sem I/O.
 */

/**
 * Dedução para um ativo que entra num balde já ocupado.
 *
 * @param {object} params
 * @param {number} params.sectorCount  quantos ativos do MESMO balde de
 *   concentração já estão no perfil (0 = é o primeiro).
 * @param {number} [params.managerCount]  quantos FIIs da MESMA gestora já estão
 *   no perfil. Ignorado quando `isFII` é falso.
 * @param {boolean} [params.isFII]
 * @param {boolean} [params.relaxSectorConcentration]  rankings mono-setor
 *   (ex.: REIT) não sofrem a dedução setorial — puniria a lista inteira.
 * @returns {number} pontos a subtrair (>= 0).
 */
export const concentrationPenaltyFor = ({
  sectorCount = 0,
  managerCount = 0,
  isFII = false,
  relaxSectorConcentration = false,
} = {}) => {
  let penalty = 0;

  if (!relaxSectorConcentration) {
    if (sectorCount >= 3) penalty += 15; // a partir do 4º ativo no mesmo balde
    else if (sectorCount >= 2) penalty += 5; // a partir do 3º
  }

  if (isFII && managerCount >= 2) penalty += 20; // a partir do 3º FII da mesma gestora

  return penalty;
};

/** Piso do score após a dedução — mesmo do draft. */
export const CONCENTRATION_SCORE_FLOOR = 10;
