# Azyvion CRM — Revisión de seguridad (2026-10-23)

Alcance: código del Lote 7 (productividad) y toda la superficie de RPC/RLS de Supabase, más
los endpoints públicos y los flujos de exportación. Método: análisis estático + **pruebas
activas** contra la base de datos real (producción), siempre dentro de transacciones que se
revierten (`RAISE EXCEPTION`), sin técnicas destructivas y sin tocar datos reales.

## Resumen
- **1 vulnerabilidad encontrada y corregida:** inyección de fórmulas en la exportación a CSV (media).
- **Backend/RLS: sin hallazgos.** Las 17 pruebas de intrusión fueron bloqueadas.
- **1 punto abierto que depende del propietario:** protección de contraseñas filtradas (SEC-10).

## Prueba de intrusión (red-team) — `tests/rls/redteam_productividad.sql`
Un atacante autenticado (ADMIN de `empresa-de-prueba`) intentó comprometer `org_azyvion_001`;
un agente intentó escalar privilegios; `anon` intentó todo. **17/17 ataques bloqueados:**

| # | Ataque | Resultado |
|---|---|---|
| R01–R02, R04 | Leer tareas, plantillas y ventas pendientes de otra empresa | Bloqueado (RLS) |
| R03 | Insertar una plantilla EN otra empresa | Bloqueado |
| R05 | Borrar una venta pendiente de otra empresa | Bloqueado (0 filas) |
| R06 | Leer la tabla `crm_auditoria` directamente | Permiso denegado |
| R07 | Fuga por la auditoría (incl. comodín `%` en la búsqueda) | Sin filas de la víctima |
| R08 | Asignar una meta a un usuario de otra empresa | Bloqueado |
| R09 | Ver el avance de metas de otra empresa | Sin usuarios de la víctima |
| R10 | Importar clientes dentro de otra empresa | Bloqueado (INVOKER + RLS) |
| R11 | Agente ejecuta importaciones / metas / auditoría | 42501 |
| R12 | Agente/otro altera o borra la auditoría | Inmutable |
| R13 | Suplantar autor/empresa de una venta pendiente | El servidor fija la identidad real |
| R14 | `anon` llama RPCs / lee tablas nuevas | 42501 / permiso denegado |
| R15–R16 | IDOR: leer/escribir credenciales FEL de otra empresa | `authorized:false` / 42501 |
| R17 | La auditoría filtra la contraseña al cambiarla | No se registra el secreto |

Comprobación posterior: ninguna fila `RT %` quedó en producción.

IDOR descartado: las funciones con parámetro `org_id` (`get/set_fel_credentials`, etc.) validan
con `get_my_role(org)`, que solo devuelve rol si el llamante es miembro de esa empresa. Las
funciones internas (`pos_cfg`, `pos_kpis_int`, `admin_*`) no son ejecutables por el cliente.

## Hallazgo corregido

### SEC-18 (Media) — Inyección de fórmulas en CSV (CWE-1236)
`descargarCSV` (`utils.js`) entrecomillaba comas y comillas, pero **no** neutralizaba las celdas
que empiezan por `= + - @` o tabulador/retorno. Un usuario podía nombrar un registro
`=HYPERLINK("http://malicioso…")` o un payload DDE; al exportar (clientes, cotizaciones,
contabilidad, auditoría, metas, etc.) y abrir el archivo en Excel/Sheets, la fórmula se
ejecutaba (exfiltración entre celdas o, con DDE, ejecución de comandos en la máquina del admin).
Afecta a **todas** las exportaciones de la app, que comparten esta función.

**Corrección:** se antepone un apóstrofo a cualquier celda que empiece por un carácter peligroso
(Excel/Sheets lo tratan como texto y no lo muestran). Prueba de regresión en
`tests/unit/security.test.js` (payloads HYPERLINK, `+`, `-`, `@`, tab; y que los valores
legítimos y el escape de comillas/separadores siguen intactos).

## Revisado y sin hallazgos
- **XSS almacenado** en las vistas nuevas (tareas, calendario, plantillas, redactor de mensajes,
  importación, auditoría CRM, metas, pendientes del POS): todo el dato de servidor se escapa con
  `E()`/`A()` antes de insertarse en el DOM. La vista previa de importación escapa cada celda.
- **Inyección SQL** en las funciones nuevas: no hay SQL dinámico con entrada de usuario; el único
  `EXECUTE format()` opera sobre una lista fija de nombres de tabla (no entrada de usuario); la
  búsqueda de auditoría usa el texto como **valor** parametrizado, no como SQL.
- **search_path**: fijado en las 10 funciones nuevas (evita secuestro por esquema).
- **Secretos en el frontend**: solo la clave `anon`/publishable (correcto); ningún `service_role`.
- **Suplantación en ventas pendientes**: un trigger `BEFORE INSERT` fija autor y empresa desde la
  sesión; lo que mande el navegador se ignora.

## Abierto (acción del propietario)
- **SEC-10 (Media):** protección de contraseñas filtradas desactivada. Supabase → Authentication →
  Providers → Email → *Prevent use of leaked passwords*. El conector no puede cambiar Auth.
- **SEC-16 (Baja):** `anon` puede **listar** el bucket público `logos-empresa` (enumerar nombres).
  Aceptable (los logos son públicos); restringir el listado si se desea.
- **SEC-17 (Baja):** `sanitizeValue` en una Edge Function rechaza textos legítimos con "update ",
  "delete ", etc. (p. ej. empresa "Delete Corp"). Molestia, no vulnerabilidad.

**Veredicto:** la capa de datos (RLS/RPC) resiste los ataques probados. Con SEC-18 corregido,
queda pendiente solo la configuración de Auth (SEC-10), que depende del propietario.
