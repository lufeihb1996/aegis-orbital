"use client";

import React from "react";
import type { QuakeEvent, SpaceWeatherData } from "@/types/telemetry";

export function Sparkline({
  data,
  positive = true,
  width = 64,
  height = 22,
}: {
  data: number[];
  positive?: boolean;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;

  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = height - pad - ((v - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const stroke = positive ? "var(--status-nominal)" : "var(--status-critical)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts.join(" ")}
      />
    </svg>
  );
}

export function KpBarChart({
  history,
}: {
  history: SpaceWeatherData["kpHistory"];
}) {
  if (!history || history.length === 0) return null;
  return (
    <div className="mt-2.5 flex items-end gap-1.5 h-12" aria-label="24h Kp Index">
      {history.map((item, idx) => {
        const ratio = Math.min(1, Math.max(0.14, item.kp / 8));
        const barColor =
          item.kp >= 6
            ? "var(--status-critical)"
            : item.kp >= 4.5
              ? "var(--status-alert)"
              : item.kp >= 3.2
                ? "var(--status-warn)"
                : "var(--accent)";
        return (
          <div
            key={`${item.time}-${idx}`}
            className="flex flex-1 flex-col items-center gap-1 h-full justify-end"
            title={`${item.time} · Kp ${item.kp}`}
          >
            <div className="relative w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-[2px]"
                style={{
                  height: `${Math.round(ratio * 100)}%`,
                  backgroundColor: barColor,
                  opacity: idx === history.length - 1 ? 1 : 0.72,
                }}
              />
            </div>
            <span className="font-mono text-[9.5px] leading-none text-[var(--text-muted)] tabular">
              {item.time.replace("Z", "")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SeismicHistogram({ quakes }: { quakes: QuakeEvent[] }) {
  const buckets = [
    { label: "2.5–3.4", count: 0, color: "var(--accent)" },
    { label: "3.5–4.4", count: 0, color: "var(--status-warn)" },
    { label: "4.5–5.4", count: 0, color: "var(--status-alert)" },
    { label: "5.5+", count: 0, color: "var(--status-critical)" },
  ];

  for (const q of quakes) {
    if (q.magnitude >= 5.5) buckets[3].count += 1;
    else if (q.magnitude >= 4.5) buckets[2].count += 1;
    else if (q.magnitude >= 3.5) buckets[1].count += 1;
    else buckets[0].count += 1;
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div className="mt-2 space-y-1.5">
      {buckets.map((b) => {
        const pct = Math.max(4, Math.round((b.count / maxCount) * 100));
        return (
          <div key={b.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-12 shrink-0 font-mono text-[var(--text-muted)] tabular">
              M{b.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[oklch(1_0_0/0.07)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${b.count === 0 ? 0 : pct}%`,
                  backgroundColor: b.color,
                }}
              />
            </div>
            <span className="w-6 text-right font-mono text-[var(--text-secondary)] tabular">
              {b.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}
