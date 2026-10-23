# POS · Lote 4 — Rediseño operativo y garantías transaccionales

Estado: **implementado y probado localmente; NO aplicado en producción ni publicado.**

## 1. Qué cambió

| Área | Antes | Ahora |
|---|---|---|
| Venta | Solo existía una fila en `Transacciones`; precio, descuento y total los dictaba el navegador; stock, contabilidad y saldo bancario en llamadas separadas | `pos_registrar_venta` (una transacción SQL): recalcula precios/lista desde `Inventario`, valida permisos, descuenta stock con `UPDATE` condicional, numera el ticket de forma atómica, registra pagos y contabilidad y es **idempotente** por clave |
| Nº de ticket | Calculado en el navegador con `localStorage` (duplicable) | `pos_secuencias` (por organización y año), arranca después del mayor número histórico |
| Pagos | Un método; sin validar | Efectivo, tarjeta y transferencia, **divisibles**; referencia obligatoria en los electrónicos; vuelto solo sobre efectivo |
| Fallos de red | Éxito/fracaso ambiguo, posible duplicado | Candado anti doble clic + clave ligada al carrito (sobrevive a recargas) + verificación automática por clave antes de permitir reintento |
| Caja | Errores tragados, "modo local" simulado, ventas sin turno, cierres repetibles | `pos_abrir_caja` / `pos_caja_movimiento` / `pos_cerrar_caja` / `pos_reabrir_caja`; ventas ligadas al turno **por el servidor**; cierre inmutable (trigger) y reapertura solo admin + auditada |
| Devoluciones | No existían | `pos_devolver_venta` (parcial, total y anulación): motivo, usuario, reingreso de stock opcional, egreso contable, saldo bancario, límites por cantidad pendiente, idempotente |
| Comprobante | Ticket con datos incompletos | Comprobante interno 80 mm con IVA desglosado, pagos, turno y cajero; rotulado "no es factura fiscal"; reimpresión autorizada y auditada |
| Interfaz | Rediseñada (`pos.js`, `pos.css`, `pos-calc.js`, marcado de `#page-pos`) | Búsqueda instantánea (nombre, SKU, categoría, código de barras si existiera), carrito editable, atajos, ventas pendientes, responsive y modo oscuro |

Tablas nuevas (solo lectura para el navegador; escriben únicamente las funciones): `pos_ventas`, `pos_venta_items`, `pos_venta_pagos`, `pos_devoluciones`, `pos_devolucion_items`, `pos_caja_movimientos`, `pos_auditoria`, `pos_secuencias`. Ninguna se puede borrar (trigger); la auditoría es de solo inserción.

### Hallazgos de seguridad corregidos en la misma migración
1. `usuarios_update_self` permitía a cualquier usuario editar **su propia** fila y el trigger existente no cubría `permisos` ni `sucursal_id`: un cajero podía otorgarse permisos de POS o cambiarse de sucursal/caja con un PATCH directo. Nuevo trigger `trg_protect_usuarios_permisos` (solo admin).
2. `Cajas_Turnos` permitía a cualquier usuario de la organización insertar/editar/borrar turnos (cierres incluidos). Ahora solo lectura + funciones; los turnos cerrados son inmutables.
3. Defecto propio detectado por las pruebas SQL antes de entregar: `pos_puede` devolvía `NULL` para usuarios sin clave `pos` y `IF NOT NULL` dejaba pasar la operación (corregido con `COALESCE`; hay prueba de regresión).

## 2. Permisos del POS

Admin, Gerente y Super Admin: todos. Resto: los que el administrador marque en **Usuarios → Permisos del Punto de Venta** (se guardan en `Usuarios.permisos.pos`): `descuento` (con tope `pos_descuento_max`, 10 % por defecto), `editar_precio` (precio de línea y lista de precios), `devolver`, `anular`, `caja_mov`, `reimprimir`. El servidor los valida en **cada** operación; la interfaz solo oculta/deshabilita controles.

## 3. Orden de despliegue (cuando se autorice)

> **Atención:** la migración retira el acceso directo a `Cajas_Turnos`. El `auth.js` publicado actualmente (apertura/cierre de caja con escritura directa) dejaría de poder abrir/cerrar caja, y el nuevo frontend no funciona sin las funciones. **Aplicar la migración y publicar el frontend en la misma ventana.**

1. Aplicar `supabase/migrations/20261023_06_pos_ventas.sql` (reversión: `20261023_06_rollback.sql`).
2. `SUPABASE_DB_URL=… bash tests/rls/run_all.sh` → debe terminar en 4 suites previas + `POSV_RESULTS: PASS=61 FAIL=0`.
3. Publicar juntos: `auth.js`, `pos.js`, `pos-calc.js`, `pos.css`, `dashboard.html`, `dashboard.css`.
4. Prueba manual mínima (ver §5).
5. Asignar permisos del POS a los cajeros que los necesiten.

## 4. Pruebas ejecutadas

| Prueba | Resultado |
|---|---|
| `tests/rls/pos_ventas.sql` (migración + 61 casos en transacción revertida contra el proyecto) | **61 / 61 PASS** |
| Suites previas con la migración aplicada (revertida): RLS 14, Lote 2 19, cotizaciones 7, stock 8 | 14/14 · 19/19 · 7/7 · 8/8 |
| Ensayo de la reversión (migración + rollback) | OK |
| `node --test tests/unit` | 46 / 46 PASS (24 nuevas del POS) |
| `node tests/check_syntax.js` | OK |
| Interfaz con servidor simulado (`tests/ui/`): caja, SKU por Enter, tope de existencias, pago dividido, referencia obligatoria, vuelto, **triple clic = 1 venta**, **respuesta perdida tras confirmar → verificación automática**, **red caída → verificar → reintento con la misma clave**, rechazo por existencia, historial, devolución parcial/exceso, botones sin permiso, cierre con diferencia, plan Starter, 1366 px, 375 px, modo oscuro | OK |
| Producción tras cada ensayo | Sin tablas, funciones ni datos de prueba residuales |

Los 61 casos SQL cubren: apertura/duplicado de caja, venta en efectivo con vuelto, contabilidad (`Transacciones` por pago), idempotencia, sobreventa sin descuento parcial, pago insuficiente/monto inválido, pago dividido + saldo bancario, descuento e IVA (incluido/sobre), servicio sin stock, permisos (precio, descuento, lista, devolución, anulación, movimiento, reimpresión, reapertura), cliente nuevo con NIT sin duplicar, devolución parcial/total/exceso/duplicada/anulación, reembolso por transferencia, efectivo esperado calculado de forma independiente, cierre (diferencia obliga a explicar, doble cierre, edición directa bloqueada), venta sin caja, reapertura auditada, numeración única, aislamiento entre organizaciones, `anon`, escritura directa denegada y autoasignación de permisos.

## 5. Prueba manual mínima tras publicar (con sesión real)
Abrir caja → vender en efectivo con vuelto → vender con tarjeta (autorización) → vender dividido → comprobar existencias en Inventario y los asientos en Contabilidad → devolver 1 artículo → anular una venta → entrada/salida de efectivo → cerrar con y sin diferencia → verificar que un cajero sin permisos no ve los botones de anular/devolver y que el servidor rechaza si se fuerza.

## 6. Pendiente / límites conocidos
- **Concurrencia real** (dos sesiones simultáneas) no ejecutada: se apoya en `UPDATE` condicional, `FOR UPDATE/FOR SHARE` y bloqueos asesores; falta una prueba con dos conexiones en staging.
- **Pruebas con sesión autenticada real** (E2E del navegador contra Supabase): no ejecutadas; la interfaz se verificó con un servidor simulado y la base con SQL. Falta confirmar en staging que `supabase-js` pasa los parámetros (`{p: …}`) como esperan las funciones.
- **Tarjeta**: no hay procesador integrado; se registra la autorización que el cajero capturó de su terminal. Requiere proveedor externo si se quiere confirmación real.
- **Factura fiscal (FEL/DTE)**: sin integración con certificador; el comprobante es interno. Requiere certificador, credenciales y flujo de anulación SAT.
- **Código de barras**: `Inventario` no tiene columna; el lector funciona con el SKU. Agregar columna si se necesita un código distinto.
- Una venta originada en una **cotización con precios negociados** distintos de la lista exige permiso `editar_precio` (Admin/Gerente lo tienen).
- Las **ventas pendientes** se guardan solo en el navegador del cajero (no son ventas ni mueven stock).
- Se dejaron de generar los asientos "Ajuste" de apertura y cierre de caja (el fondo no es ingreso ni capital); el cuadre vive en `Cajas_Turnos` y las tablas `pos_*`. Si Contabilidad requiere registrar faltantes/sobrantes, definir la cuenta y el criterio contable.
- El reporte de ventas por sucursal sigue leyendo ingresos brutos de `Transacciones`; las devoluciones aparecen como egresos (no restan en ese reporte).
- `Transacciones` sigue siendo editable por usuarios de la organización vía RLS (fuera del alcance de este lote).
- Distintos puntos de venta por sucursal: el turno es uno por sucursal (caja compartida entre cajeros), igual que el comportamiento previo.

## 7. Archivos
Nuevos: `pos-calc.js`, `pos.css`, `supabase/migrations/20261023_06_pos_ventas.sql`, `…_06_rollback.sql`, `tests/rls/pos_ventas.sql`, `tests/unit/pos.test.js`, `tests/ui/{pos_harness.html,mock_api.js,serve.js}`, `.claude/launch.json` (arnés).
Modificados: `auth.js` (capa POS/caja vía RPC), `pos.js` (reescrito; se conservaron la búsqueda por NIT y la prueba FEL), `dashboard.html` (marcado de `#page-pos`, permisos POS en usuarios, enlaces), `dashboard.css` (se retiraron los estilos POS obsoletos), `tests/rls/run_all.sh`. Respaldo previo en `supabase/backup/20261023_lote4/`.

---

# Lote 5 — Configuración del POS por empresa (Ajustes → Empresa)

Estado: **implementado y probado localmente; migración 07 NO aplicada y frontend NO publicado.**

Todo se guarda en `Organizations.pos_config` (jsonb) y `Organizations.redes_sociales` (jsonb), se edita en **Ajustes → Empresa** (módulo `pos-config-ui.js`) y el servidor lo **valida** (trigger `trg_org_pos_config`: tipos, rangos, claves desconocidas descartadas) y lo **aplica** en las funciones del POS. Solo administradores/gerentes pueden guardarlo (RLS existente).

| Configuración | Dónde se aplica |
|---|---|
| Descuento máximo por defecto | Servidor (`pos_registrar_venta`) |
| Vender sin existencias: no / con permiso `sin_stock` / todos | Servidor + interfaz |
| Aviso de stock bajo (umbral) | Interfaz |
| NIT obligatorio desde Q X | Servidor + interfaz |
| Propina (habilitar, % sugeridos) | Servidor (se cobra con la venta; `pos_ventas.propina`) + interfaz |
| Métodos de pago habilitados y nombre visible | Servidor (venta y reembolso) + interfaz |
| Caja obligatoria: automática / siempre / nunca | Servidor + interfaz |
| Redondeo de efectivo (0.05 … 1.00) | Servidor (`pos_ventas.redondeo`) + interfaz |
| Tolerancia de cuadre / diferencia máxima sin supervisor | Servidor (`pos_cerrar_caja`) + interfaz |
| Efectivo máximo en caja (alerta de retiro) | Servidor (`pos_estado_caja`) + interfaz |
| Horas máximas de turno + bloqueo opcional | Servidor + interfaz (recordatorio) |
| Plazo de devolución (días; admin puede autorizar fuera de plazo) | Servidor |
| Motivos de devolución (lista) y motivos que no reingresan inventario | Servidor (valida el motivo) + interfaz (reingreso por defecto) |
| Comprobante: ancho 58/80 mm, encabezado, SKU, cajero, turno, IVA, redes, QR, copias, impresión automática | Interfaz |
| **Redes sociales** (Facebook, Instagram, TikTok, WhatsApp, X, YouTube) | Se capturan en Ajustes → Empresa y se imprimen en el comprobante **solo desde esos datos** |

Nuevo permiso por usuario: `sin_stock` (para el modo «con permiso»). Migración: `20261023_07_pos_config.sql` (+ `_07_rollback.sql`, que restaura las funciones de la 06). Archivos nuevos: `pos-config-ui.js`, `vendor/qrcode.min.js` (qrcode-generator 1.4.4, MIT, local para no depender de CDN), `tests/rls/pos_config.sql`.

**Pruebas:** SQL `pos_config.sql` 29/29; `pos_ventas.sql` 61/61 y las 4 suites previas sin regresiones con la migración 07 aplicada (ensayo revertido); unitarias 53/53; interfaz (arnés): propina, redondeo, métodos con nombre propio, NIT obligatorio, aviso de stock bajo, comprobante 58 mm con redes + QR + encabezado, ida y vuelta del formulario de Ajustes (28 claves). Un hallazgo corregido: el trigger de validación debía ser `SECURITY DEFINER` (sin eso un admin no podía guardar la empresa).

**Notas y límites**
- El cierre de turno **nunca es automático** (hay que contar el efectivo): solo recordatorio y bloqueo opcional.
- La propina se cobra y registra en la venta, pero contablemente entra dentro del ingreso del cobro; si Contabilidad requiere una cuenta de pasivo para propinas, hay que definirla.
- «Caja obligatoria = siempre» en plan Starter impide vender (Starter no puede abrir caja).
- El QR contiene solo el número de venta (no es un código fiscal).
- El ancho 58 mm y la impresión automática/copias dependen del navegador/impresora; no se probó con impresora térmica real.
- Pendiente probar en staging con sesión real (igual que el Lote 4).

**Orden de despliegue:** aplicar `_07_pos_config.sql` → correr `run_all.sh` → publicar `pos.js`, `pos-calc.js`, `pos-config-ui.js`, `pos.css`, `auth.js`, `perfil.js`, `dashboard.html` y `vendor/qrcode.min.js`.

---

# Lote 6 — Negocio: reportes, compras con costo, kardex, conteo, seguimiento

Estado: **implementado y probado localmente; migración 08 NO aplicada y frontend NO publicado.**

| Función | Dónde |
|---|---|
| **Historial de compras del cliente** (resumen, ticket promedio, lo que más compra, ventas con «Ver ticket») | Ficha del cliente → pestaña **Compras** (`pos_historial_cliente`) |
| **Tablero de ventas**: ventas netas, tickets, ticket promedio, margen, devoluciones, descuentos, comparación con el período anterior, gráfica por día, por método/cajero/sucursal, más vendidos, sin movimiento; exportar CSV e imprimir/PDF | **Reportes → Ventas** |
| **Cierre consolidado** de cajas por período y sucursal | Reportes → Cierres de caja |
| **Comisiones** por cajero/vendedor (base: ventas netas sin IVA; % por usuario o por defecto de la empresa) | Reportes → Comisiones; % en Usuarios y en Ajustes → Empresa |
| **Auditoría visible** (quién hizo qué) | **Auditoría POS** (solo administradores) |
| **Proveedores** y **compras** (contado/crédito, pago posterior, anulación) con **costo promedio ponderado** | Compras e inventario |
| **Kardex automático**: toda variación de existencias (venta, devolución, compra, ajuste, edición manual) queda registrada con usuario y referencia | Compras e inventario → Kardex |
| **Ajustes** (mermas) y **conteo físico** con aplicación auditada | Compras e inventario → Kardex / Conteo |
| **Reposición**: stock mínimo, faltante, sugerido, último proveedor, «crear compra con lo sugerido» | Compras e inventario → Reposición |
| **Código de barras** (único por empresa; el POS ya lo busca) y **etiquetas con QR** | Producto → Código de barras; Compras → Etiquetas |
| **Seguimiento**: clientes que no vuelven y cumpleaños, con botón **WhatsApp** y mensajes configurables | Seguimiento de clientes; fecha de nacimiento en la ficha del cliente |
| **WhatsApp del comprobante** y **pedir opinión** (enlace de encuesta configurable) | Diálogo de venta registrada / comprobante |
| **Perfiles de rol de ejemplo** (Cajero, Vendedor, Supervisor, Bodeguero, Contador) y permisos nuevos `reportes`, `compras`, `inventario_ajuste`, `sin_stock` | Usuarios → Permisos |
| Margen: el **costo se congela en cada venta** (`pos_venta_items.costo_unit`) | automático |

Migración: `20261023_08_negocio.sql` (+ `_08_rollback.sql`, que restaura las funciones de la 07). Todas las escrituras son por funciones transaccionales con permisos; las compras son idempotentes; los registros no se borran; el kardex es de solo inserción.

**Pruebas:** SQL `negocio.sql` 28/28; suites previas sin regresiones (61, 29, 14, 19, 7, 8) con la 08 aplicada (ensayo revertido); reversión probada; unitarias 60/60; interfaz en arnés (`tests/ui/negocio_harness.html`): reportes, compra con doble clic = 1 llamada, reposición, conteo, kardex, etiquetas, seguimiento con enlaces de WhatsApp, auditoría.

**Corrección incluida:** al editar un producto desde el formulario ya **no se reescriben las existencias** con el valor cargado al abrirlo (antes, una venta hecha mientras el formulario estaba abierto se perdía en silencio).

**Límites / pendientes de este lote**
- El margen es parcial mientras haya productos sin costo (el reporte lo avisa). El costo promedio se alimenta con **Compras** o editando el costo del producto.
- Las compras a crédito se pagan con «Registrar pago»; no hay (aún) un módulo completo de cuentas por pagar con vencimientos.
- La anulación de una compra exige que las existencias recibidas sigan disponibles (si ya se vendieron, no se anula).
- El conteo físico no descuenta ventas hechas después de iniciarlo: aplicarlo con el comercio sin vender.
- WhatsApp abre el mensaje listo para enviar (enlace `wa.me`); no hay envío automático ni API. El correo sigue dependiendo del webhook existente.
- **No incluido** (necesita rediseño o decisiones del negocio): traslados entre sucursales (el inventario hoy es un solo stock por producto, no por sucursal), lotes/vencimientos/series, apartados con anticipo y la reserva de stock en cotizaciones.
- **Siguiente lote propuesto:** cuentas por cobrar / venta a crédito, vales y notas de crédito, puntos y niveles de cliente. Tocan el flujo de dinero del POS, por eso se harán aparte, con sus propias pruebas.

**Orden de despliegue:** aplicar `20261023_08_negocio.sql` → `run_all.sh` → publicar `auth.js`, `pos.js`, `pos-calc.js`, `pos-config-ui.js`, `negocio.js`, `pos.css`, `inventario.js`, `clientes.js`, `ficha-pro.js`, `dashboard.html` (solo los cambios del POS/Negocio; ver nota de Contabilidad) y `vendor/qrcode.min.js` (ya publicado).
