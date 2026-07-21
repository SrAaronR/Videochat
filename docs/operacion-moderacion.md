# Operación de moderación humana

Procedimiento para el equipo que atiende la moderación. La moderación
humana NO es opcional en este producto: un videochat con desconocidos al
azar es, de forma documentada, un foco de abuso; sin personas atendiendo
la sala de vigilancia y las denuncias, el servicio no debe estar abierto.

> Este documento es un procedimiento operativo, no asesoramiento legal.
> Las obligaciones exactas de denuncia y conservación dependen de la
> jurisdicción de la entidad operadora: confírmalas con el abogado que
> revise los Términos (ver `checklist-lanzamiento.md`).

## 1. Herramientas

Todo está en el panel `https://app.<tudominio>/admin` (contraseña en el
`.env` del servidor, variable `ADMIN_PASSWORD`):

- **Denuncias**: cola de denuncias de usuarios (con captura del vídeo del
  denunciado cuando la hay) y de avisos del detector NSFW automático.
  Acciones: banear o descartar.
- **Vigilancia**: salas activas en tiempo real con capturas periódicas de
  cada cámara. Acción: banear al participante directamente.
- **Baneos**: baneos activos (por IP hasheada + fingerprint, escalados:
  temporal → permanente). Acción: levantar un ban erróneo.
- **Métricas**: usuarios conectados, colas, matches y denuncias por hora.

## 2. Cobertura

- La sala de vigilancia debe estar **atendida siempre que el servicio esté
  abierto**. Si no hay nadie para cubrir un horario, es preferible cerrar
  el servicio ese horario (parar el contenedor `web`) a dejarlo sin vigilar.
- Objetivo de respuesta: denuncias con motivo **"menor"** al momento;
  resto de denuncias en < 15 minutos.
- Rota a las personas moderadoras (sesiones cortas): revisar este tipo de
  contenido desgasta. Prevé apoyo psicológico si el volumen crece.

## 3. Criterios por tipo de denuncia

| Motivo | Acción |
| --- | --- |
| Desnudez / contenido sexual | Ban directo (escalado automático temporal → permanente). |
| **Menor de edad** | Protocolo de la sección 4 COMPLETO. Nunca "solo banear". |
| Acoso | Con evidencia (captura/chat): ban. Sin evidencia clara: descartar y anotar. |
| Spam | Ban. |
| Avisos NSFW automáticos | Son del detector ML del cliente (falsos positivos frecuentes): revisar la captura antes de decidir. |

En caso de duda entre banear o descartar: banear. Es un servicio anónimo;
un ban injusto tiene coste mínimo y se puede levantar.

## 4. Protocolo ante posible material de abuso infantil (CSAM) o menores en el servicio

Si en una denuncia, en la sala de vigilancia o en una captura aparece un
posible menor (como víctima o como usuario):

1. **Banea inmediatamente** la sesión (permanente).
2. **No descartes la denuncia**: el registro en base de datos (captura,
   IP hasheada, fingerprint, timestamps) es la evidencia. No borres nada.
3. **NO descargues, copies, reenvíes ni almacenes** el material fuera del
   sistema. Poseer o redistribuir CSAM es delito aunque la intención sea
   denunciarlo; la evidencia se queda donde está y se da acceso a las
   autoridades que lo requieran.
4. **Denúncialo a las autoridades el mismo día**:
   - **España**: Policía Nacional (denuncias telemáticas o 091) o Guardia
     Civil — Grupo de Delitos Telemáticos (gdt.guardiacivil.es). Para
     orientación: INCIBE, línea 017.
   - **Internacional**: NCMEC CyberTipline (report.cybertip.org, EE. UU.) y
     la red de líneas INHOPE (inhope.org) para el país correspondiente.
   - El abogado debe confirmar si la entidad tiene obligación legal de
     denuncia y ante quién (en la UE aplica, además, la normativa de
     servicios digitales).
5. **Registra el incidente** en un log interno: fecha/hora UTC, id de
   denuncia, qué se observó, acciones tomadas, referencia de la denuncia
   policial. Este registro es lo que demuestra diligencia.
6. Si hay indicios de peligro inmediato para un menor identificable,
   llama al 112 (o al equivalente local) además de lo anterior.

## 5. Protección de datos (RGPD)

- Las capturas de denuncias/vigilancia son datos personales: acceso solo
  para el equipo de moderación, bajo la contraseña del panel. No se
  comparten fuera salvo requerimiento de autoridades.
- Define y aplica un plazo de retención para denuncias resueltas (p. ej.
  90 días salvo incidentes denunciados a autoridades, que se conservan) —
  a confirmar con el abogado y reflejar en la Política de Privacidad.
- La supervisión de cámara está declarada al usuario (aviso en sala +
  Términos + Privacidad). Si cambias cómo funciona, actualiza esos textos.

## 6. Cuentas pendientes de implementación técnica

Mejoras razonables si el volumen crece (no bloqueantes para empezar):

- Cuentas individuales para moderadores (ahora hay una sola contraseña).
- Log de incidentes CSAM dentro del propio panel (ahora: log externo).
- Exportación de evidencia con hash para entregas a autoridades.
