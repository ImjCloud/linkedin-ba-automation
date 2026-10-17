import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'LinkedIn BA Automation', description: 'Private daily LinkedIn thought leadership automation status.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body style={{fontFamily:'system-ui, sans-serif', maxWidth:760, margin:'48px auto', padding:'0 20px', lineHeight:1.6, color:'#18212f'}}>{children}</body></html>;
}
