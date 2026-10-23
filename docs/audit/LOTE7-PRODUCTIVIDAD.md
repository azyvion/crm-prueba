# Lote 7 — Productividad: tareas, plantillas, importación, auditoría general, metas y pendientes del POS

Estado (2026-10-23): **migración 09 APLICADA en producción** (registrada en el historial como `20261023200000 crm_productividad_20261023`; `productividad.sql` 19/19 PASS después de aplicarla). **Frontend pendiente de publicar** (lo publica el propietario).

## Estado real de producción (verificado hoy, en solo lectura)
- Las migraciones **06, 07 y 08 ya están aplicadas** en Supabase, aunque no figuran en `list_migrations` (se aplicaron fuera del historial).
- El frontend publicado en `azyvion.github.io/crm-prueba` es **idéntico byte a byte** a la línea base local (commit `ed1d793`). Es decir, los Lotes 1 a 6 ya están en producción.
- Hay uso real del POS nuevo: una caja abierta y una venta del 2026-10-23 a las 19:16 UTC.
- La empresa `org_azyvion_001` tiene **0 clientes** (antes tenía). Por eso T05 de `rls_regression.sql` falla: es un dato, no un defecto.

## Qué se agregó

| Función | Dónde | Notas |
|---|---|---|
| **Tareas y recordatorios** con fecha, hora, prioridad y responsable; posponer (+1 día); completar/reabrir | Menú **Tareas** (todos los roles salvo cajero) | Se construyen sobre `ActividadesCRM`. Las actividades existentes con fecha de seguimiento aparecen como tareas (no se modificó ningún dato). |
| **Calendario mensual** | Tareas → Calendario | Tocar un día crea una tarea en esa fecha. |
| **Recordatorios** | Insignia en el menú, aviso al entrar, aviso 15 min antes de las tareas con hora, avisos del navegador opcionales | Se revisa cada 5 minutos con la app abierta. No envía correo ni push con la app cerrada. |
| **Ver todo el equipo** y asignar responsable | Tareas (solo ADMIN/GERENTE) | |
| **Plantillas de WhatsApp y correo** con variables `{nombre} {empresa} {mi_nombre} {mi_empresa} {fecha}` | Config. → **Plantillas de mensajes** | Solo ADMIN/GERENTE las editan (RLS); todos las usan. Sin plantillas propias se ofrecen 4 de ejemplo. |
| **Enviar mensaje** desde la ficha | Ficha del cliente/prospecto | Abre WhatsApp (`wa.me`) o el correo (`mailto:`) y **registra el envío en la línea de tiempo**. No hay envío automático por API. |
| **Nueva tarea** desde la ficha y casilla «Hecha» en la línea de tiempo | Ficha | |
| **Importar CSV** de clientes y productos | Config. → **Importar datos** | Detecta `,` o `;`, BOM, comillas y Windows-1252; mapeo automático de columnas; **validación sin guardar** obligatoria antes de importar; máx. 5000 filas; plantilla CSV descargable. Clientes: solo ADMIN/GERENTE. Productos: ADMIN/GERENTE o permiso `compras`/`inventario_ajuste`. |
| **Auditoría general** (antes → después) de Clientes, Prospectos, Cotizaciones, Productos, Usuarios, Transacciones, Plantillas y Metas | **Auditoría → Cambios en el CRM** (solo ADMIN/GERENTE) | Por triggers en el servidor (no se puede saltar desde el navegador). Nunca guarda contraseñas ni campos calculados. Las existencias siguen en el kardex. |
| **Metas por vendedor** (ventas sin IVA, cotizaciones aprobadas, actividades) con barra de avance | **Reportes → Metas**; «Mi meta del mes» en Tareas | Asignar: solo ADMIN/GERENTE. Con permiso `reportes` se ve a todos; sin él, solo la propia. |
| **Alerta de stock mínimo** con los productos concretos y acceso a Reposición | Inicio | Usa `stock_minimo` (el mismo que Reposición). |
| **Ventas pendientes del POS en el servidor** | POS → Pendientes (F7/F8) | Compartidas entre equipos. Al retomarla se «reclama» primero en el servidor: dos cajeros no pueden cobrar la misma. Las que estaban solo en el navegador se suben solas. |

**Corrección incluida (FN-25):** registrar una actividad **sin** fecha de seguimiento enviaba `''` a una columna `date`, y el guardado fallaba. Ahora se envía `null`.

## Archivos
- BD: `supabase/migrations/20261023_09_crm_productividad.sql` (+ `20261023_09_rollback.sql`).
- Nuevos: `productividad.js`, `productividad.css`, `tests/rls/productividad.sql`, `tests/unit/productividad.test.js`, `tests/ui/productividad_harness.html`.
- Modificados: `auth.js` (API), `dashboard.html` (menú, páginas, títulos, submenús), `negocio.js` (Metas, Auditoría CRM), `pos.js` (pendientes), `ficha-pro.js` (tareas y mensajes), `overview.js` (alertas), `tests/ui/mock_api.js`, `tests/rls/run_all.sh`.

## Pruebas (ejecutadas)
| Prueba | Resultado |
|---|---|
| `productividad.sql` con **solo la 09** sobre el estado real (ensayo revertido) | **19/19 PASS** |
| `pos_ventas.sql` con la 09 aplicada (ensayo revertido) | **61/61 PASS** |
| Con 06–09 reaplicadas: `pos_config` 29/29, `negocio` 28/28, `rls_lote2_org_fel` 19/19, `cotizaciones_integridad` 7/7, `pos_stock` 8/8 | **PASS** |
| `rls_regression.sql` | 13/14: T05 falla **igual sin la 09** (la org tiene 0 clientes) |
| Reversión `_09_rollback.sql` (ensayo) | Sin tablas, funciones ni triggers restantes |
| Verificación posterior de producción | Sin rastro de los ensayos; la caja y la venta reales intactas |
| Unitarias (`node --test "tests/unit/*.test.js"`) | **71/71 PASS** (10 nuevas) |
| Sintaxis (`node tests/check_syntax.js`) | 43/43 |
| Interfaz en arnés con API simulada | Tareas (completar, posponer, crear con validación, ver equipo, calendario), plantillas, redactor (WhatsApp y registro), importación (mapeo, error por fila, validación obligatoria), metas (guardar), auditoría CRM, pendientes POS (subida de locales, reclamo, «ya tomada»), modo oscuro y 375 px sin desplazamiento horizontal |

Las pruebas SQL de POS fallan si hay una caja **ABIERTA** real. En el ensayo se cierra con un `UPDATE` dentro de la misma transacción revertida.

**No verificado:** la interfaz con una sesión real contra Supabase (igual que en los lotes anteriores, falta una cuenta de prueba o un entorno staging).

## Orden de despliegue
1. Aplicar `20261023_09_crm_productividad.sql` (aditiva; ver la nota de rendimiento).
2. Ejecutar `tests/rls/productividad.sql` → 19/19.
3. Publicar: `productividad.js`, `productividad.css`, `auth.js`, `dashboard.html`, `negocio.js`, `pos.js`, `ficha-pro.js`, `overview.js`.
4. Prueba manual: crear una tarea con hora → ver la insignia; enviar un WhatsApp desde una ficha → aparece en la línea de tiempo; validar e importar un CSV de 2 clientes; editar un cliente → verlo en Auditoría → Cambios en el CRM.

**Compatibilidad:** la 09 es compatible con el frontend publicado hoy. Solo agrega columnas con valor por defecto, tablas nuevas y triggers `AFTER`. `refId` pasa a ser opcional. Se puede aplicar primero y publicar después.

**Rendimiento:** cada alta, cambio o baja en las 8 tablas auditadas inserta una fila en `crm_auditoria`. Con el volumen actual es despreciable. La tabla crece sin límite: conviene definir una retención (por ejemplo, 2 años).

**Reversión:** `_09_rollback.sql` borra plantillas, metas, pendientes, auditoría general y las columnas de tareas. Respaldar esas tablas antes si ya tienen datos.

## Pendiente que requiere decisión o acción del propietario
- **Aplicar la 09 y publicar** (este lote).
- **Protección de contraseñas filtradas** (SEC-10): Supabase → Authentication → activarla. El conector no puede hacerlo.
- **Decisiones de datos** pendientes: FN-16 (2 cotizaciones con total inflado), FN-23 (3 cotizaciones con cliente borrado), FN-24 (4 cuentas sin perfil), SEC-13 (hash legado).
- **Por qué hay 0 clientes en Azyvion**: confirmar si fue intencional.
- **Entorno staging** (proyecto Supabase aparte, con costo) para pruebas E2E con sesión real.
- **FEL real**: elegir un certificador (Infile, Digifact, etc.) y obtener credenciales de prueba. Sin eso no se puede integrar.
- **Avisos por correo/push con la app cerrada** (tareas y stock): requieren una Edge Function programada y un proveedor de correo.

**No hecho en este lote**, porque es trabajo grande y de riesgo que conviene hacer aparte:
- Dividir `dashboard.html` (8,000 líneas) en módulos.
- Unificar las dos fuentes de organización (ARC-01: `Usuarios` y `user_roles`).
