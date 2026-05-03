import { Router } from 'express';

const router = Router();

const BASE_URL = 'https://verticeinvest.com.br';

const PAGES = [
    { url: '/', priority: '1.0', changefreq: 'weekly' },
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
