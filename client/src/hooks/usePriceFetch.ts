import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { marketService } from '../services/market';
import { getLocalDateString, type AssetFormState } from '../utils/assetTransaction';

interface UsePriceFetchArgs {
  isOpen: boolean;
  form: AssetFormState;
  setForm: Dispatch<SetStateAction<AssetFormState>>;
}

/**
 * Busca automática de preço (M3, extraída do AddAssetModal). Encapsula:
 * - debounce de 600ms + cache de sessão (`Map<ticker-date-type>`);
 * - cotação ao vivo (data = hoje) ou histórica (data passada);
 * - escreve o preço sugerido de volta no `form` e expõe o estado de UI
 *   (loading, fonte, preço sugerido, data encontrada, se é preço atual).
 */
export function usePriceFetch({ isOpen, form, setForm }: UsePriceFetchArgs) {
  const [isFetchingPrice, setIsFetchingPrice] = useState(false);
  const [priceSource, setPriceSource] = useState<'manual' | 'historical'>('manual');
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [historicalDateFound, setHistoricalDateFound] = useState<string | null>(null);
  const [isCurrentPrice, setIsCurrentPrice] = useState(false);

  const priceCache = useRef<Map<string, any>>(new Map());
  const priceFetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyPriceData = (data: any, targetDate: string) => {
    if (data && data.price) {
      const fmtPrice = data.price.toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      setForm((prev) => ({ ...prev, price: fmtPrice }));
      setPriceSource('historical');
      setSuggestedPrice(data.price);
      if (data.isLive) setIsCurrentPrice(true);
      else if (data.foundDate && data.foundDate !== targetDate) setHistoricalDateFound(data.foundDate);
    }
    setIsFetchingPrice(false);
  };

  useEffect(() => {
    if (
      !isOpen ||
      form.type === 'CASH' ||
      form.type === 'FIXED_INCOME' ||
      !form.ticker ||
      form.ticker.length < 3 ||
      !form.date
    ) {
      return;
    }

    if (priceFetchTimeoutRef.current) clearTimeout(priceFetchTimeoutRef.current);

    // Cache primeiro.
    const cacheKey = `${form.ticker}-${form.date}-${form.type}`;
    if (priceCache.current.has(cacheKey)) {
      applyPriceData(priceCache.current.get(cacheKey), form.date);
      return;
    }

    setIsFetchingPrice(true);
    setHistoricalDateFound(null);
    setIsCurrentPrice(false);
    setSuggestedPrice(null);

    priceFetchTimeoutRef.current = setTimeout(async () => {
      try {
        const today = getLocalDateString();
        let priceData = null;

        if (form.date === today) {
          const quote = await marketService.getCurrentQuote(form.ticker);
          if (quote && quote.price > 0) {
            priceData = { price: quote.price, isLive: true };
          }
        } else if (form.date < today) {
          const history = await marketService.getHistoricalPrice(form.ticker, form.date, form.type);
          if (history && history.price > 0) {
            priceData = history;
          }
        }

        if (priceData) {
          priceCache.current.set(cacheKey, priceData);
          applyPriceData(priceData, form.date);
        } else {
          setPriceSource('manual');
        }
      } catch (err) {
        console.error('Erro ao buscar preço', err);
      } finally {
        setIsFetchingPrice(false);
      }
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date, form.ticker, form.type, isOpen]);

  /** Marca o preço como manual (usuário digitou). */
  const setManual = () => {
    setPriceSource('manual');
    setIsCurrentPrice(false);
  };

  /** Limpa a meta de preço (usado ao reabrir o modal). */
  const reset = () => {
    setPriceSource('manual');
    setSuggestedPrice(null);
    setHistoricalDateFound(null);
    setIsCurrentPrice(false);
    setIsFetchingPrice(false);
  };

  return {
    isFetchingPrice,
    priceSource,
    suggestedPrice,
    historicalDateFound,
    isCurrentPrice,
    setManual,
    reset,
  };
}
