import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/components/shared/providers";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "FlowFit 통합 운영 엔진",
  description: "고객 흐름과 운영 엔진 흐름을 하나의 콘솔에서 관리하는 FlowFit 통합 콘솔",
  icons: {
    icon: "/flowfit-symbol.png",
    apple: "/flowfit-symbol.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
