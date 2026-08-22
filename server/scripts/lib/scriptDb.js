/**
 * Conexão de banco para scripts de linha de comando (auditorias, diagnósticos).
 *
 * Até 22/08/2026 cada script chamava `mongoose.connect(process.env.MONGO_URI)`
 * cru, sem opção nenhuma, rodando com os defaults do driver — pool sem mínimo,
 * sem IPv4 forçado, sem socketTimeout calibrado. É o mesmo defeito que derrubou
 * o `sync:prod` (ba12668, 2fcb98e) e que, em escala menor, derruba a auditoria:
 * o handshake TLS deste cluster Atlas custa 9,5s no melhor caso e estoura os
 * timeouts default, então a auditoria falha de forma intermitente ANTES de ler
 * uma linha — duas vezes seguidas no mesmo minuto, em 22/08/2026.
 *
 * Aqui o script reusa as MESMAS opções do servidor (`MONGO_CONNECT_OPTIONS` de
 * config/db.js) e re-tenta a conexão quando a queda é de transporte.
 *
 * NÃO usa `connectDB()` de propósito, apesar de ser "o conector do servidor":
 *  - ele roda `healLegacyIndexes()`, que faz `dropIndex` — ESCRITA de esquema no
 *    banco de PRODUÇÃO, inaceitável num script que se declara read-only;
 *  - ele engole o erro de conexão fora de produção e retorna normalmente, o que
 *    faria a auditoria seguir e falhar depois, com erro pior de diagnosticar;
 *  - ele registra listeners de reconexão que mantêm o processo vivo.
 * Nada aqui sobe scheduler nem servidor HTTP: só o pool do driver, que o
 * `mongoose.disconnect()` do próprio script fecha, deixando o processo sair.
 */
import mongoose from 'mongoose';
import { MONGO_CONNECT_OPTIONS } from '../../config/db.js';
import { withMongoRetry } from '../../utils/mongoResilience.js';

/**
 * Conecta com as opções endurecidas, re-tentando quedas transitórias.
 * @param {object} [opts]
 * @param {string} [opts.label] rótulo do script nos logs de re-tentativa.
 * @returns {Promise<typeof mongoose>}
 */
export const connectScriptDb = async ({ label = 'script' } = {}) => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI não definida — verifique o .env da raiz do projeto.');

  return withMongoRetry(async () => {
    // Uma tentativa que falhou pode deixar a conexão em `connecting`; zerar antes
    // de re-tentar evita o "Can't call openUri() on an active connection".
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect().catch(() => {});
    return mongoose.connect(uri, MONGO_CONNECT_OPTIONS);
  }, { label: `connect:${label}` });
};
