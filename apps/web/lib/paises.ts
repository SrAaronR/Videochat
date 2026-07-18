/**
 * Lista de países para el filtro opcional de emparejamiento.
 * Códigos ISO-3166 alpha-2 (los mismos que devuelve geoip-lite en servidor).
 * No es exhaustiva: cubre los mercados principales; ampliar según necesidad.
 */
export const PAISES: ReadonlyArray<{ codigo: string; nombre: string }> = [
  { codigo: 'ES', nombre: 'España' },
  { codigo: 'MX', nombre: 'México' },
  { codigo: 'AR', nombre: 'Argentina' },
  { codigo: 'CO', nombre: 'Colombia' },
  { codigo: 'CL', nombre: 'Chile' },
  { codigo: 'PE', nombre: 'Perú' },
  { codigo: 'VE', nombre: 'Venezuela' },
  { codigo: 'EC', nombre: 'Ecuador' },
  { codigo: 'UY', nombre: 'Uruguay' },
  { codigo: 'PY', nombre: 'Paraguay' },
  { codigo: 'BO', nombre: 'Bolivia' },
  { codigo: 'CR', nombre: 'Costa Rica' },
  { codigo: 'PA', nombre: 'Panamá' },
  { codigo: 'DO', nombre: 'República Dominicana' },
  { codigo: 'GT', nombre: 'Guatemala' },
  { codigo: 'US', nombre: 'Estados Unidos' },
  { codigo: 'BR', nombre: 'Brasil' },
  { codigo: 'PT', nombre: 'Portugal' },
  { codigo: 'FR', nombre: 'Francia' },
  { codigo: 'DE', nombre: 'Alemania' },
  { codigo: 'IT', nombre: 'Italia' },
  { codigo: 'GB', nombre: 'Reino Unido' },
  { codigo: 'IE', nombre: 'Irlanda' },
  { codigo: 'NL', nombre: 'Países Bajos' },
  { codigo: 'BE', nombre: 'Bélgica' },
  { codigo: 'CH', nombre: 'Suiza' },
  { codigo: 'AT', nombre: 'Austria' },
  { codigo: 'PL', nombre: 'Polonia' },
  { codigo: 'RO', nombre: 'Rumanía' },
  { codigo: 'SE', nombre: 'Suecia' },
  { codigo: 'NO', nombre: 'Noruega' },
  { codigo: 'CA', nombre: 'Canadá' },
  { codigo: 'AU', nombre: 'Australia' },
  { codigo: 'NZ', nombre: 'Nueva Zelanda' },
  { codigo: 'JP', nombre: 'Japón' },
  { codigo: 'KR', nombre: 'Corea del Sur' },
  { codigo: 'IN', nombre: 'India' },
  { codigo: 'MA', nombre: 'Marruecos' },
  { codigo: 'TR', nombre: 'Turquía' },
];

/** Nombre legible de un código de país, o el propio código si no está en la lista. */
export function nombrePais(codigo: string | null): string | null {
  if (!codigo) return null;
  return PAISES.find((p) => p.codigo === codigo)?.nombre ?? codigo;
}
