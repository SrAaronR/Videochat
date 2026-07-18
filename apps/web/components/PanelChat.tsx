'use client';

/**
 * Panel de chat de texto de la sala: lista de mensajes con autoscroll,
 * indicador "está escribiendo…" y campo de envío.
 * En escritorio se muestra lateral; en móvil, como panel inferior.
 */

import { useEffect, useRef } from 'react';
import type { EstadoChat, MensajeChat } from '@videochat/shared';

/** Mensaje ya anotado con si lo escribió este cliente. */
export interface MensajeUI extends MensajeChat {
  propio: boolean;
}

interface Props {
  estado: EstadoChat;
  mensajes: MensajeUI[];
  borrador: string;
  peerEscribiendo: boolean;
  alCambiarBorrador: (valor: string) => void;
  alEnviar: () => void;
}

export default function PanelChat({
  estado,
  mensajes,
  borrador,
  peerEscribiendo,
  alCambiarBorrador,
  alEnviar,
}: Props) {
  const finListaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    finListaRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, peerEscribiendo]);

  const conectado = estado === 'conectado';

  return (
    <aside
      aria-label="Chat de texto"
      className="flex h-48 flex-none flex-col border-t border-slate-800 bg-slate-950 md:h-auto md:w-96 md:border-l md:border-t-0"
    >
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {mensajes.length === 0 && conectado && (
          <p className="text-center text-sm text-slate-500">Estás conectado. ¡Di hola!</p>
        )}
        {mensajes.map((mensaje) => (
          <div
            key={mensaje.id}
            className={`flex ${mensaje.propio ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${
                mensaje.propio ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
            >
              <p className="break-words text-sm">{mensaje.texto}</p>
              <time
                dateTime={new Date(mensaje.timestamp).toISOString()}
                className="mt-0.5 block text-right text-[10px] text-slate-300/70"
              >
                {new Date(mensaje.timestamp).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </div>
        ))}
        {peerEscribiendo && (
          <p className="text-sm italic text-slate-400">El desconocido está escribiendo…</p>
        )}
        <div ref={finListaRef} />
      </div>

      <form
        className="flex gap-2 border-t border-slate-800 p-3"
        onSubmit={(evento) => {
          evento.preventDefault();
          alEnviar();
        }}
      >
        <input
          value={borrador}
          onChange={(evento) => alCambiarBorrador(evento.target.value)}
          placeholder={conectado ? 'Escribe un mensaje…' : 'Esperando pareja…'}
          disabled={!conectado}
          aria-label="Mensaje"
          maxLength={2000}
          className="min-w-0 flex-1 rounded-xl bg-slate-800 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-indigo-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!conectado || !borrador.trim()}
          className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold transition hover:bg-indigo-400 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Enviar
        </button>
      </form>
    </aside>
  );
}
