import type { Metadata } from "next";
import "./globals.css";
import { Geist, JetBrains_Mono, Unbounded } from "next/font/google";
import { cn } from "@/lib/utils";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { auth } from "@/lib/auth";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
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
      <body
        suppressHydrationWarning
        className="antialiased min-h-screen bg-bg text-fg"
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <SidebarProvider>
            <AppSidebar session={session} />
            <div className="relative flex min-h-svh flex-1 min-w-0 w-full bg-bg overflow-x-hidden">
              <main className="flex-1 w-full min-w-0">{children}</main>
            </div>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
