import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { I18nProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Trendscope", template: "%s · Trendscope" },
  description: "E-commerce trend & competitive intelligence: products, shops, ads and creators — linked and scored.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const theme = (await cookies()).get("ts_theme")?.value === "dark" ? "dark" : "light";
  const body = (
    <html lang={locale} data-theme={theme} className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <I18nProvider locale={locale}>
          <TooltipProvider>{children}</TooltipProvider>
        </I18nProvider>
      </body>
    </html>
  );
  if (process.env.AUTH_MODE === "clerk") {
    const { ClerkProvider } = await import("@clerk/nextjs");
    return <ClerkProvider>{body}</ClerkProvider>;
  }
  return body;
}
