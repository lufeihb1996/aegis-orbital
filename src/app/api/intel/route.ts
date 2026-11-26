import { NextResponse } from "next/server";
import { FALLBACK_INTEL } from "@/lib/fallback-data";
import type { IntelFeedData, MarketTicker, TechIntelItem } from "@/types/telemetry";

const BINANCE_SYMBOLS = [
  { pair: "BTCUSDT", symbol: "BTC", name: "Bitcoin" },
  { pair: "ETHUSDT", symbol: "ETH", name: "Ethereum" },
  { pair: "SOLUSDT", symbol: "SOL", name: "Solana" },
  { pair: "PAXGUSDT", symbol: "XAU", name: "Gold (PAXG)" },
];

async function fetchMarkets(): Promise<MarketTicker[] | null> {
  try {
    const symbolsParam = encodeURIComponent(
      JSON.stringify(BINANCE_SYMBOLS.map((s) => s.pair))
    );
    const res = await fetch(
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbolsParam}`,
      {
        signal: AbortSignal.timeout(5000),
        next: { revalidate: 30 },
      }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      openPrice: string;
      highPrice: string;
      lowPrice: string;
    }>;

    const byPair = new Map(rows.map((r) => [r.symbol, r]));
    const tickers: MarketTicker[] = [];

    for (const cfg of BINANCE_SYMBOLS) {
      const r = byPair.get(cfg.pair);
      if (!r) continue;
      const last = parseFloat(r.lastPrice);
      const open = parseFloat(r.openPrice);
      const high = parseFloat(r.highPrice);
      const low = parseFloat(r.lowPrice);
      const pct = parseFloat(r.priceChangePercent);

      // Build deterministic smooth 8-point intraday contour from OHLC
      const mid1 = open + (low - open) * 0.65;
      const mid2 = (open + high) * 0.5;
      const mid3 = (low + high) * 0.52;
      const mid4 = high - (high - last) * 0.35;
      const sparkline = [
        open,
        (open + mid1) / 2,
        mid1,
        mid2,
        mid3,
        mid4,
        (mid4 + last) / 2,
        last,
      ];

      tickers.push({
        symbol: cfg.symbol,
        name: cfg.name,
        price: last,
        change24h: Number(pct.toFixed(2)),
        high24h: high,
        low24h: low,
        sparkline,
      });
    }

    return tickers.length > 0 ? tickers : null;
  } catch {
    return null;
  }
}

async function fetchTechNews(): Promise<TechIntelItem[] | null> {
  try {
    const idsRes = await fetch(
      "https://hacker-news.firebaseio.com/v0/topstories.json",
      {
        signal: AbortSignal.timeout(4500),
        next: { revalidate: 180 },
      }
    );
    if (!idsRes.ok) return null;
    const ids = ((await idsRes.json()) as number[]).slice(0, 10);

    const stories = await Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            {
              signal: AbortSignal.timeout(4000),
              next: { revalidate: 180 },
            }
          );
          if (!r.ok) return null;
          return (await r.json()) as {
            id: number;
            title?: string;
            url?: string;
            score?: number;
            descendants?: number;
            by?: string;
            time?: number;
          };
        } catch {
          return null;
        }
      })
    );

    const items: TechIntelItem[] = [];
    for (const s of stories) {
      if (!s || !s.title) continue;
      const url = s.url ?? `https://news.ycombinator.com/item?id=${s.id}`;
      let domain = "news.ycombinator.com";
      try {
        domain = new URL(url).hostname.replace(/^www\./, "");
      } catch {
        domain = "news.ycombinator.com";
      }
      items.push({
        id: s.id,
        title: s.title,
        url,
        score: s.score ?? 0,
        comments: s.descendants ?? 0,
        by: s.by ?? "unknown",
        time: (s.time ?? Math.floor(Date.now() / 1000)) * 1000,
        domain,
      });
    }
    return items.length > 0 ? items.slice(0, 8) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const [markets, news] = await Promise.all([fetchMarkets(), fetchTechNews()]);

  const source: IntelFeedData["source"] =
    markets && news ? "live" : markets || news ? "partial" : "fallback";

  const payload: IntelFeedData = {
    markets: markets ?? FALLBACK_INTEL.markets,
    news: news ?? FALLBACK_INTEL.news,
    updatedAt: new Date().toISOString(),
    source,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
    },
  });
}
