import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";

// next/font downloads the fonts at build time and self-hosts them (no layout shift, no Google request
// at runtime). Each exposes a CSS variable that globals.css maps to --font-display / --font-sans.
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["500", "600", "700"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: "Couch — watch together",
  description: "Start a room, share the link, and everyone's video plays, pauses and seeks together.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <div className="atmosphere" aria-hidden />
        {children}
      </body>
    </html>
  );
}
