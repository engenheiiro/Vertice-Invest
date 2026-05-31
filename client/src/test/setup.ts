// Setup global dos testes do client.
// Registra os matchers do jest-dom (toBeInTheDocument, etc.) e garante que o
// DOM renderizado é limpo após cada teste, evitando contaminação entre eles.
import '@testing-library/jest-dom';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
