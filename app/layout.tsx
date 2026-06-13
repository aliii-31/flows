import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inflow",
  description: "Money that arrives builds your score.",
};

export const viewport: Viewport = {
  themeColor: "#14110F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <Providers>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
