import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { marketService } from '../services/market';
import { formatUnitPriceInput, getLocalDateString, type AssetFormState } from '../utils/assetTransaction';

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
  // Id da busca mais recente; resposta com id diferente chegou atrasada e é descartada.
  const requestIdRef = useRef(0);

  const applyPriceData = (data: any, targetDate: string) => {
    if (data && data.price) {
      // Abaixo de 1 mantém até 8 significativos (SHIB não pode virar "0,00").
      const fmtPrice = formatUnitPriceInput(data.price);
      setForm((prev) => {
        const next = { ...prev, price: fmtPrice };
        // Autofill do nome real (vindo da cotação) sem sobrescrever o que o
        // usuário digitou — só quando está vazio ou ainda é o próprio ticker.
        const incoming = (data.name || '').trim();
        const current = (prev.name || '').trim();
        const tickerUp = (prev.ticker || '').trim().toUpperCase();
        if (incoming && incoming.toUpperCase() !== tickerUp &&
            (!current || current.toUpperCase() === tickerUp)) {
          next.name = incoming;
        }
        return next;
      });
      setPriceSource('historical');
      setSuggestedPrice(data.price);
      if (data.isLive) setIsCurrentPrice(true);
      else if (data.foundDate && data.foundDate !== targetDate) setHistoricalDateFound(data.foundDate);
    }
    setIsFetchingPrice(false);
  };

  useEffect(() => {
    // Cada execução invalida a busca anterior: a resposta de um ticker/data que
    // o usuário já trocou chega depois e sobrescrevia o preço do valor novo.
    const requestId = ++requestIdRef.current;
    const isStale = () => requestId !== requestIdRef.current;

    if (
      !isOpen ||
      form.type === 'CASH' ||
      form.type === 'FIXED_INCOME' ||
      !form.ticker ||
      form.ticker.length < 3 ||
      !form.date
    ) {
      // A busca em voo (se havia) acabou de ser descartada — sem isto o
      // spinner ficaria girando para sempre.
      setIsFetchingPrice(false);
      return;
    }

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
            priceData = { price: quote.price, isLive: true, name: quote.name };
          }
        } else if (form.date < today) {
          const history = await marketService.getHistoricalPrice(form.ticker, form.date, form.type);
          if (history && history.price > 0) {
            priceData = history;
          }
        }

        if (isStale()) return;
        if (priceData) {
          priceCache.current.set(cacheKey, priceData);
          applyPriceData(priceData, form.date);
        } else {
          setPriceSource('manual');
        }
      } catch (err) {
        // (A11) falha na cotação degrada visivelmente para entrada manual
        // (em vez de ficar em estado indefinido silencioso).
        if (isStale()) return;
        console.error('Erro ao buscar preço', err);
        setPriceSource('manual');
      } finally {
        if (!isStale()) setIsFetchingPrice(false);
      }
    }, 600);

    // Troca de input ou desmontagem: o debounce pendente não dispara mais.
    return () => {
      if (priceFetchTimeoutRef.current) clearTimeout(priceFetchTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- busca só quando data/ticker/tipo mudam; callbacks e cache são estáveis por ref
  }, [form.date, form.ticker, form.type, isOpen]);

  // Desmontagem invalida a busca em voo (nenhum setState após unmount).
  useEffect(() => () => { requestIdRef.current++; }, []);

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
