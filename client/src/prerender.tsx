import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import React from 'react';
import type { PrerenderArguments, PrerenderResult } from 'vite-prerender-plugin';
import { Landing } from './pages/Landing';
import { Terms } from './pages/Terms';

export async function prerender({ url }: PrerenderArguments): Promise<PrerenderResult> {
  let html = '';

  try {
    if (url === '/') {
      html = renderToStaticMarkup(
        <StaticRouter location={url}>
          <Landing />
        </StaticRouter>
      );
    } else if (url === '/terms') {
      html = renderToStaticMarkup(
        <StaticRouter location={url}>
          <Terms />
        </StaticRouter>
      );
    }
  } catch (e) {
    console.warn(`[prerender] Falhou ao renderizar ${url}:`, e);
  }

  return {
    html,
    links: url === '/' ? new Set(['/terms']) : undefined,
  };
}
