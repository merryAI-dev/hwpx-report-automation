import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_KR } from "next/font/google";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { AppNav } from "@/components/common/AppNav";
import { ToastContainer } from "@/components/common/ToastContainer";
import { KeyboardShortcutsPanel } from "@/components/common/KeyboardShortcutsPanel";
import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const ibmMono = IBM_Plex_Mono({
  variable: "--font-code",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "HWPX Studio",
  description: "Style-safe HWPX editing and AI suggestions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} ${ibmMono.variable}`}>
        <ErrorBoundary>
          <AppNav />
          {children}
          <ToastContainer />
          <KeyboardShortcutsPanel />
        </ErrorBoundary>
      </body>
    </html>
  );
}
