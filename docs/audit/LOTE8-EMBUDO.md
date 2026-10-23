# Lote 8 — Embudo de ventas: valor y probabilidad por etapa, pronóstico mensual y motivo de pérdida

## Estado (2026-10-23)
- Migración `20261023_10_embudo_ventas.sql`: **APLICADA en producción** el 2026-10-23 (registrada como `20261023204346 embudo_ventas_20261023`).
  Después de aplicarla, `embudo.sql` dio 12/12, `productividad.sql` 19/19 y `redteam_productividad.sql` 17/17 sobre el estado real (todo revertido).
  Se verificó que no quedaron filas de prueba: 2,612 prospectos, igual que antes.
- Frontend: local, **sin publicar**. El propietario lo publica (paso 3 del despliegue).

## Qué se agregó
- **Etapa «Ganado».** «Convertir en cliente» ya no borra el prospecto: la función `crm_convertir_prospecto`
  (SECURITY INVOKER, atómica) crea el cliente (`prospectoOrigenId`) y deja el prospecto como Ganado con
  `clienteId`. Así quedan el historial y la tasa de cierre. También corrige un defecto: antes el alta del
  cliente y el borrado del prospecto corrían en paralelo sin revisar errores.
- **Fecha de cierre estimada** (`fecha_cierre_estimada`), filtro «Vencidos» y orden por fecha de cierre.
- **Motivo de pérdida** (`motivo_perdida` + detalle): es obligatorio al pasar a Perdido (lo exige el trigger
  `trg_prospecto_cierre`). Los 1,435 perdidos anteriores no tienen motivo y se pueden seguir editando.
- **Cierre automático:** al pasar a Ganado o Perdido se guardan `cerrado_en`/`cerrado_por` y la probabilidad
  queda en 100/0. Al reabrir la oportunidad se limpian.
- **Probabilidad sugerida por etapa** (10/20/40/60/80) al cambiar de etapa; se puede ajustar en las etapas abiertas.
- **Embudo** por etapa: cantidad, probabilidad promedio, valor y ponderado. **Pronóstico** de 6 meses
  (ponderado, total y ya ganado), con vencidos, sin fecha y posteriores mostrados aparte. **Tasa de cierre** de 90 días.
  **Motivos de pérdida** de 90 días.
- Validaciones en la BD: etapa válida, probabilidad 0–100 y valor ≥ 0. Los datos actuales cumplen.
- Corrección: una probabilidad 0 se guardaba como 50 (`Number(x)||50`).
- Resúmenes (`getResumen`, Inicio, IA): «Ganado» ya no cuenta como oportunidad abierta.

## Archivos
`embudo-calc.js` (cálculos puros), `embudo.css`, `prospectos.js`, `auth.js`, `dashboard.html`, `utils.js`,
`overview.js`, `ai.js`; `supabase/migrations/20261023_10_*`; `tests/rls/embudo.sql`, `tests/unit/embudo.test.js`,
`tests/ui/embudo_harness.html`.

## Pruebas (ejecutadas)
| Prueba | Resultado |
|---|---|
| `embudo.sql` (migración 10 + suite, revertido) | **12/12 PASS** (motivo obligatorio, cierre, reabrir, perdido anterior editable, validaciones, conversión atómica, doble conversión, aislamiento entre empresas, anon) |
| `productividad.sql` / `redteam_productividad.sql` con la 10 encima | 19/19 · 17/17 |
| `rls_regression.sql` con la 10 encima | 13/14 (T05: fallo conocido, Azyvion tiene 0 clientes) |
| Producción después del ensayo | sin columnas ni funciones nuevas; sin filas QA |
| Unitarias (`node --test tests/unit/*.test.js`) | 85/85 |
| Arnés de interfaz (escritorio, móvil 375 px y tema oscuro) | embudo, pronóstico, motivos, filtro «Vencidos», Perdido sin motivo bloqueado, conversión; sin errores de consola ni desbordamiento horizontal |

## Orden de despliegue (importa)
1. Aplicar `20261023_10_embudo_ventas.sql` **antes** de publicar el frontend: el frontend nuevo envía
   columnas y llama a una función que no existen sin la migración (guardar prospectos fallaría).
2. Ejecutar `tests/rls/embudo.sql` → 12/12.
3. Publicar los archivos del frontend (incluidos los nuevos `embudo-calc.js` y `embudo.css`).
4. Prueba manual: editar un prospecto con fecha de cierre, marcar uno como Perdido (debe pedir motivo) y convertir uno en cliente.

## Pendiente / ideas siguientes
- Probabilidades por etapa configurables por empresa (hoy son fijas en `embudo-calc.js`).
- Motivos de pérdida personalizables por empresa.
- Los perdidos anteriores no tienen `cerrado_en`, así que no entran en la tasa de cierre (es intencional).
