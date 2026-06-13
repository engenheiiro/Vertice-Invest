import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { walletService } from '../services/wallet';
import { useToast } from '../contexts/ToastContext';
import type { AssetFormState } from '../utils/assetTransaction';
import type { AssetType } from '../contexts/WalletContext';

interface UseAssetSearchArgs {
  form: AssetFormState;
  transactionType: 'BUY' | 'SELL';
  setForm: Dispatch<SetStateAction<AssetFormState>>;
}

/**
 * Autocomplete de ticker / busca de ativo (M3, extraída do AddAssetModal).
 * Encapsula resultados, visibilidade do dropdown, debounce de 300ms e o
 * fechamento ao clicar fora. `containerRef` deve envolver o campo de ticker.
 */
export function useAssetSearch({ form, transactionType, setForm }: UseAssetSearchArgs) {
  const { addToast } = useToast();
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  // (A10) índice destacado para navegação por teclado no dropdown.
  const [activeIndex, setActiveIndex] = useState(-1);

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora do campo.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Dispara a busca debounced para o valor de ticker digitado. */
  const searchTicker = (val: string) => {
    // Venda usa <select> de ativos da carteira; CASH não tem busca.
    if (transactionType === 'SELL' || form.type === 'CASH') return;

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    const minChars = form.type === 'FIXED_INCOME' ? 2 : 3;

    if (val.length >= minChars) {
      setIsSearching(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const results = await walletService.searchAsset(val, form.type);
          setActiveIndex(-1); // (A10) novo conjunto de resultados → reseta destaque
          if (results && Array.isArray(results) && results.length > 0) {
            setSearchResults(results);
            setShowDropdown(true);
          } else if (form.type === 'FIXED_INCOME') {
            setSearchResults([{ ticker: val, name: `Criar: ${val}`, type: 'FIXED_INCOME', isManual: true }]);
            setShowDropdown(true);
          } else {
            setSearchResults([]);
            setShowDropdown(false);
          }
        } catch {
          // (A11) erro de busca agora é visível ao usuário, não mais silencioso.
          setSearchResults([]);
          setShowDropdown(false);
          addToast('Não foi possível buscar o ativo. Verifique sua conexão.', 'error');
        } finally {
          setIsSearching(false);
        }
      }, 300);
    } else {
      setSearchResults([]);
      setShowDropdown(false);
    }
  };

  /** Aplica o resultado escolhido no formulário. */
  const selectResult = (result: any) => {
    let rateVal = form.rate;
    if (result.rate !== undefined && result.rate !== null) {
      rateVal = result.rate.toString().replace('.', ',');
      if (!rateVal.includes(',')) rateVal += ',00';
    }

    const finalTicker = result.isManual ? result.ticker : result.ticker || result.name;
    const finalName = result.name || result.ticker;
    const finalType = result.type ? (result.type as AssetType) : form.type;
    const finalQty = finalType === 'FIXED_INCOME' ? '1' : form.quantity;
    // Índice do título (SELIC/CDI/IPCA/PRE) para accrual pós-fixado correto.
    const finalIndex = result.index ? String(result.index).toUpperCase() : undefined;

    setForm((prev) => ({
      ...prev,
      ticker: finalTicker,
      name: finalName,
      type: finalType,
      rate: rateVal,
      quantity: finalQty,
      fixedIncomeIndex: finalIndex,
    }));

    setShowDropdown(false);
    setSearchResults([]);
    setActiveIndex(-1);
  };

  const reset = () => {
    setSearchResults([]);
    setShowDropdown(false);
    setActiveIndex(-1);
  };

  /** (A10) Navegação por teclado no dropdown: setas, Enter e Escape. */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < searchResults.length) {
        e.preventDefault();
        selectResult(searchResults[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
      setActiveIndex(-1);
    }
  };

  return {
    searchResults,
    showDropdown,
    setShowDropdown,
    isSearching,
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    containerRef,
    searchTicker,
    selectResult,
    reset,
  };
}
