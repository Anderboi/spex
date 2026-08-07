import type { Metadata } from "next";
import "./globals.css";
import { Geist, JetBrains_Mono, Unbounded } from "next/font/google";
import { cn } from "@/lib/utils";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
  title: { default: "Balans Design", template: "%s | Balans" },
  description: "Приложение для управления материалами для дизайна интерьера",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "Balans App",
  },
};

const geist = Geist({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-sans",
});

const spaceGrotesk = Unbounded({
  subsets: ["latin", "cyrillic"],
  variable: "--font-unbounded",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-mono",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={cn(
        geist.variable,
        spaceGrotesk.variable,
        jetbrainsMono.variable,
        "font-sans",
      )}
      suppressHydrationWarning
    >
      <body className="antialiased min-h-screen bg-bg text-fg">
        <SidebarProvider>
          <AppSidebar />
          <div className="relative flex min-h-svh flex-1 flex-col min-w-0 w-full bg-bg overflow-x-hidden">
            <header className="flex h-8 items-center gap-2 px-4">
              <SidebarTrigger />
            </header>
            <main className="flex-1 w-full min-w-0">{children}</main>
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
