import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, Source_Serif_4, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const sourceSerif4 = Source_Serif_4({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'OpenResearch — Open-Source AI Academic Research & Writing Assistant',
  description: 'Grounded academic writing, citations, literature discovery, and AI research assistant.',
};

// Applies the stored (or system) theme before first paint to avoid a flash.
const themeInitScript = `
(function () {
  try {
    var theme = localStorage.getItem('theme');
    if (theme !== 'dark' && theme !== 'light') {
      theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${inter.variable} ${sourceSerif4.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen bg-canvas text-text-primary antialiased selection:bg-accent/20 font-sans">
        {/* next/script keeps the pre-paint theme script working across client re-renders
            (a raw <script> tag is never executed when React renders on the client). */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {children}
      </body>
    </html>
  );
}
