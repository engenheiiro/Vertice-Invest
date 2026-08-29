// Setup global dos testes do client.
// Registra os matchers do jest-dom (toBeInTheDocument, etc.) e garante que o
// DOM renderizado é limpo após cada teste, evitando contaminação entre eles.
import '@testing-library/jest-dom';
import { afterEach, vi, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import { toHaveNoViolations } from 'jest-axe';

// Registra matcher de acessibilidade globalmente em todos os testes.
expect.extend(toHaveNoViolations);

// jsdom não implementa matchMedia — necessário para useIsMobile e afins.
// Default: desktop (não-mobile). Testes podem sobrescrever window.matchMedia.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom não implementa scrollIntoView — usado pelo overlay do tutorial.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom não implementa Blob.text()/arrayBuffer() — usados pela importação de
// carteira para ler a planilha no navegador. Ambos são suportados por todos os
// navegadores alvo desde 2019; a lacuna é só do ambiente de teste. O FileReader,
// esse sim, o jsdom implementa, então o polyfill é uma ponte de uma linha.
const readVia = <T>(blob: Blob, read: (r: FileReader) => void): Promise<T> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader);
  });

if (!Blob.prototype.text) {
  Blob.prototype.text = function () {
    return readVia<string>(this, (r) => r.readAsText(this));
  };
}

if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function () {
    return readVia<ArrayBuffer>(this, (r) => r.readAsArrayBuffer(this));
  };
}

afterEach(() => {
  cleanup();
});
