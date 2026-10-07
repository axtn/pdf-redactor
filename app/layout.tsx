import type { Metadata } from 'next';
import { DM_Sans, Space_Grotesk } from 'next/font/google';
import './globals.css';

const bodyFont = DM_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-body' });
const headingFont = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-heading',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://pdf.axtn.io'),
  alternates: { canonical: '/' },
  title: 'PDF Redactor — axtn.io',
  description: 'Redact PDFs and remove hidden metadata, entirely in your browser.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${bodyFont.variable} ${headingFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
