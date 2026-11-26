"use client";

import { usePathname } from "next/navigation";
import { DEMO_FX } from "@/lib/money/uk-locale";
import { useCallback, useEffect, useState } from "react";
import type { FxRates } from "@/lib/money/fx";
import { DEFAULT_FX } from "@/lib/money/fx";

const CACHE_KEY = "money:uk-fx-rates";

function loadCachedRates(): FxRates {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { rates, ts } = JSON.parse(raw);
      if (
        Date.now() - ts < 60 * 60 * 1000 &&
        rates?.USDCAD > 0 &&
        rates?.USDEGP > 0 &&
        rates?.USDGBP > 0 &&
        rates?.USDEUR > 0
      ) {
        return rates;
      }
    }
  } catch {}
  return DEFAULT_FX;
}

function saveCachedRates(rates: FxRates) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rates, ts: Date.now() }));
  } catch {}
}

export function useMoneyFx() {
  const pathname = usePathname();
  const authenticatedMain = process.env.NEXT_PUBLIC_AUTHENTICATED_APP === "true";
  const demo = pathname.startsWith("/demo") || process.env.NEXT_PUBLIC_UK_DEMO_ONLY === "true";
  const [fx, setFx] = useState<FxRates>(demo ? DEMO_FX : DEFAULT_FX);
  const [ready, setReady] = useState(demo || authenticatedMain);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (demo || authenticatedMain) {
      setFx(demo ? DEMO_FX : DEFAULT_FX);
      setReady(true);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/stocks?symbols=USDCAD=X,USDEGP=X,USDGBP=X,USDEUR=X");
      const data = await res.json();
      const USDCAD = data?.results?.["USDCAD=X"]?.price;
      const USDEGP = data?.results?.["USDEGP=X"]?.price;
      const USDGBP = data?.results?.["USDGBP=X"]?.price;
      const USDEUR = data?.results?.["USDEUR=X"]?.price;
      if (
        Number.isFinite(USDGBP) &&
        USDGBP > 0 &&
        Number.isFinite(USDEUR) &&
        USDEUR > 0 &&
        Number.isFinite(USDCAD) &&
        USDCAD > 0 &&
        Number.isFinite(USDEGP) &&
        USDEGP > 0
      ) {
        const rates = { USDCAD, USDEGP, USDGBP, USDEUR };
        setFx(rates);
        saveCachedRates(rates);
      }
    } catch {
      // keep current rates
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, [demo, authenticatedMain]);

  useEffect(() => {
    if (demo || authenticatedMain) {
      setFx(demo ? DEMO_FX : DEFAULT_FX);
      setReady(true);
      return;
    }
    const cached = loadCachedRates();
    if (cached.USDCAD !== 1 || cached.USDEGP !== 1) {
      setFx(cached);
      setReady(true);
    }
    refresh();
    const id = setInterval(refresh, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh, demo, authenticatedMain]);

  return { fx, loading, ready, refresh };
}
