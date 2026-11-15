import type { Metadata } from "next";
import localFont from "next/font/local";
import Link from "next/link";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Antclass — Multimodal AI Learning Engine",
  description: "Turn any document into mind maps, flashcards, stories, podcasts, games, videos and songs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} font-sans antialiased min-h-screen`}>
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white text-sm">
                🐜
              </span>
              <span>
                Ant<span className="text-violet-600">class</span>
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-500">
              <Link href="/teacher" className="hover:text-violet-600">
                👩‍🏫 Teacher
              </Link>
              <Link href="/student" className="hover:text-fuchsia-600">
                🧑‍🎓 Student
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
