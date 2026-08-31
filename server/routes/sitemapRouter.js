import { Router } from 'express';

const router = Router();

const BASE_URL = 'https://verticeinvest.com.br';

// Só páginas públicas e estáveis. Login e cadastro ficam de fora de propósito
// (são formulário, não conteúdo) e já saem com noindex.
const PAGES = [
    { url: '/', priority: '1.0', changefreq: 'weekly' },
    // A vitrine de planos deixou de exigir login em 30/08/2026; é a página que
    // vende, então vem logo depois da inicial.
    { url: '/pricing', priority: '0.9', changefreq: 'monthly' },
    { url: '/privacy', priority: '0.3', changefreq: 'yearly' },
    { url: '/terms', priority: '0.3', changefreq: 'yearly' },
];

router.get('/sitemap.xml', (req, res) => {
    const lastmod = new Date().toISOString().split('T')[0];

    const urls = PAGES.map(page => `
  <url>
    <loc>${BASE_URL}${page.url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>`).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(xml);
});

export default router;
