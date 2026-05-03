import { useEffect } from 'react';

interface PageMetaProps {
    title?: string;
    description?: string;
    canonical?: string;
    ogImage?: string;
    noindex?: boolean;
    jsonLd?: object;
}

const BASE_TITLE = 'Vértice Invest';
const BASE_URL = 'https://verticeinvest.com.br';
const DEFAULT_IMAGE = `${BASE_URL}/og-image.png`;

function setMetaName(name: string, content: string) {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.name = name;
        document.head.appendChild(el);
    }
    el.content = content;
}

function setMetaProp(property: string, content: string) {
    let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', property);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
}

export function PageMeta({
    title,
    description,
    canonical,
    ogImage = DEFAULT_IMAGE,
    noindex = false,
    jsonLd,
}: PageMetaProps) {
    const fullTitle = title
        ? `${title} — ${BASE_TITLE}`
        : `${BASE_TITLE} — Análise Quantitativa de Ações, FIIs e Cripto`;
    const canonicalUrl = canonical ? `${BASE_URL}${canonical}` : undefined;

    useEffect(() => {
        document.title = fullTitle;

        if (description) setMetaName('description', description);
        setMetaName('robots', noindex ? 'noindex, nofollow' : 'index, follow');

        setMetaProp('og:title', fullTitle);
        if (description) setMetaProp('og:description', description);
        setMetaProp('og:image', ogImage);
        if (canonicalUrl) setMetaProp('og:url', canonicalUrl);

        setMetaName('twitter:title', fullTitle);
        if (description) setMetaName('twitter:description', description);
        setMetaName('twitter:image', ogImage);

        // canonical link tag
        let linkEl = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
        if (canonicalUrl) {
            if (!linkEl) {
                linkEl = document.createElement('link');
                linkEl.rel = 'canonical';
                document.head.appendChild(linkEl);
            }
            linkEl.href = canonicalUrl;
        }

        // JSON-LD
        const existing = document.querySelector('script[data-pageMeta="ld"]');
        if (jsonLd) {
            const s = (existing as HTMLScriptElement) ?? document.createElement('script');
            s.setAttribute('type', 'application/ld+json');
            s.setAttribute('data-pageMeta', 'ld');
            s.textContent = JSON.stringify(jsonLd);
            if (!existing) document.head.appendChild(s);
        } else {
            existing?.remove();
        }
    }, [fullTitle, description, noindex, ogImage, canonicalUrl, jsonLd]);

    return null;
}
