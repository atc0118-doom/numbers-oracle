import type { ReactNode } from 'react';
import './style.css';

export const metadata = {
  title: 'NUMBERS ORACLE',
  description: 'ナンバーズ3・4 自動分析予想',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
