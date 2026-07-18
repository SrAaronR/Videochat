import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoredChat — videochat aleatorio',
  description: '¿Aburrido? Habla con desconocidos al azar: vídeo y chat de texto 1 contra 1.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
