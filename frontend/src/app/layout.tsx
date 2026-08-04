import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI Internet Safety Center",
  description: "Local-first phishing and scam detection prototype",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="flex items-center gap-6 border-b border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-black">
          <Link href="/" className="text-sm font-medium text-black dark:text-zinc-50">
            Scan
          </Link>
          <Link href="/history" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            History
          </Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
