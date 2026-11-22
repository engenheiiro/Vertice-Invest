/**
 * Varredura leve de segredos: formatos de credencial que têm assinatura
 * reconhecível. Não substitui o gitleaks (que roda no CI); existe porque o
 * gitleaks não está em toda máquina e o gancho dele pula em silêncio.
 */
export const PADROES_SEGREDO = [
  { nome: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { nome: 'Mercado Pago (produção)', re: /\bAPP_USR-\d{10,}-\d{6}-[0-9a-f]{20,}/ },
  { nome: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { nome: 'GitHub token', re: /\b(?:ghp|gho|ghs|ghu)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{40,}/ },
  { nome: 'Slack token', re: /\bxox[abpr]-[0-9A-Za-z-]{10,}/ },
  { nome: 'Stripe live key', re: /\bsk_live_[0-9A-Za-z]{20,}/ },
  { nome: 'Chave privada', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { nome: 'URI do Mongo com senha', re: /mongodb(?:\+srv)?:\/\/[^:\s'"`/]+:[^@\s'"`<>${}]{6,}@/ },
];

/** @returns {{linha: number, tipo: string}[]} */
export function encontrarSegredos(texto) {
  const achados = [];
  texto.split(/\r?\n/).forEach((linha, i) => {
    for (const p of PADROES_SEGREDO) if (p.re.test(linha)) achados.push({ linha: i + 1, tipo: p.nome });
  });
  return achados;
}

/** Arquivo que nunca carrega segredo versionável (binário, lockfile). */
export function ignorarNaVarredura(caminho) {
  return /(^|\/)package-lock\.json$|\.(png|jpe?g|webp|gif|ico|svg|woff2?|ttf|pdf|zip|mp4)$/i.test(caminho);
}
