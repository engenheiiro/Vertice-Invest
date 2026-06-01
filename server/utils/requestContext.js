/**
 * (D12) Contexto por requisição via AsyncLocalStorage.
 *
 * Permite que qualquer ponto do código (controllers, services) recupere o
 * correlation id da requisição atual sem precisar passá-lo por parâmetro. O
 * logger usa isso para carimbar todas as linhas de log com o mesmo id, tornando
 * possível rastrear uma requisição inteira nos logs (e correlacionar com o
 * header `x-request-id` devolvido ao cliente).
 */
import { AsyncLocalStorage } from 'async_hooks';

const storage = new AsyncLocalStorage();

export const requestContext = storage;

/** Executa `fn` dentro de um contexto que carrega `requestId`. */
export const runWithRequestId = (requestId, fn) => storage.run({ requestId }, fn);

/** Id da requisição atual (ou undefined fora de um request). */
export const getRequestId = () => storage.getStore()?.requestId;
