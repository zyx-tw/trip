import type { Metadata } from "next";
import { Noto_Sans_TC } from "next/font/google";

import "./globals.css";
import { NextPageDecode } from "@/components/page-decode-next";

// Han characters outside Maple Mono's subset, in slices a page loads on use.
const notoSansTcNotoSansTc = Noto_Sans_TC({subsets:['latin'],variable:'--font-noto-sans-tc'});

export const metadata: Metadata = {
  title: "旅行",
  icons: "https://www.zyx.tw/favicon.ico",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh-Hant"
      className={notoSansTcNotoSansTc.variable}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://ui.zyx.tw/fonts/maple-mono-nf-cn.css"
        />
      </head>
      <body>
        <NextPageDecode />
        {children}
      </body>
    </html>
  );
}
