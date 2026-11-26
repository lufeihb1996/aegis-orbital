import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEGIS // ORBITAL — 3D 全球实时态势与情报指挥大屏",
  description:
    "Cinema-grade 3D Global Real-Time Intelligence Command Center: live USGS seismic waves, SGP4 orbital tracking for ISS & Tiangong CSS, NASA EONET disasters, NOAA space weather, Open-Meteo coordinate weather probes, submarine cable backbone & live tech/market radar.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      data-theme="cyan"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="h-full w-full overflow-hidden">{children}</body>
    </html>
  );
}
