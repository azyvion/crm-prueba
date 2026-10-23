# Azyvion CRM — Registro de defectos

Proyecto Supabase `dwtykzporgjjvdustjfq` · Código: carpeta local `crm-prueba-main` (copia de `azyvion/crm-prueba`, publicado en `https://azyvion.github.io/crm-prueba/`).
Actualizado: Lote 2 (2026-10-23 UTC).

Estados: **CORREGIDO** (en producción y verificado) · **BACKEND-OK / FRONT-PENDIENTE** (BD/Edge corregidos y verificados; el archivo del frontend está corregido localmente pero **no publicado**) · **CORREGIDO-LOCAL** (solo frontend, no publicado) · **ABIERTO** · **REQUIERE-APROBACIÓN** (corrección de datos que necesita autorización del propietario).

> Nota sobre el repositorio: `azyvion/CRM-AZYVION` (último push 2026-10-01) **no** es la versión en producción. La app viva se sirve desde `azyvion/crm-prueba` (último push 2026-10-13). Comparado archivo por archivo: solo difieren los archivos que modificó esta auditoría.

## Seguridad

| ID | Sev. | Módulo | Defecto (causa raíz) | Corrección | Estado / evidencia |
|---|---|---|---|---|---|
| SEC-01 | Crítico | Datos de negocio | Política `sala_anon_select`: cualquiera sin login leía todos los datos de `org_azyvion_001`. | Eliminada (migración `security_hardening_20261023`). | **CORREGIDO** — 0 políticas `sala_anon*`; T01 PASS; HTTP anon a `Clientes` → `[]`. |
| SEC-02 | Crítico | Edge `admin-user-manager` | `createUser` reutilizaba cuentas Auth existentes (secuestro/borrado de cuentas de otra empresa). | v6: 409 si el correo existe; rollback solo de lo creado en la llamada. | **BACKEND-OK** — v6 desplegada; fuente desplegada = repo. Invocación autenticada **BLOQUEADA** (sin JWT de prueba). |
| SEC-03 | Alto | Edge `admin-user-manager` | Email/borrado no validaban el rol real del objetivo → ADMIN podía tomar al SUPER_ADMIN. | v6 `authorizeOnTarget` con `user_roles`. | **BACKEND-OK** (igual que SEC-02). Negativos HTTP: sin token 401, token anon 401. |
| SEC-04 | Alto | RPC | `admin_create_usuario_profile` ejecutable por anon. | EXECUTE revocado. | **CORREGIDO** — T04/T15 PASS. |
| SEC-05 | Alto | Storage | Escritura/borrado entre empresas. | Prefijo por org/usuario. | **CORREGIDO** — T09/T10 PASS. |
| SEC-06 | Alto | Varias | Políticas `{public}` con `organization_id IS NULL`. | Eliminadas. | **CORREGIDO** — T02 PASS. |
| SEC-07 | Medio | Usuarios | AGENTE podía desactivar/borrar al ADMIN. | Políticas separadas. | **CORREGIDO** — T06/T07/T16/T17 PASS. |
| SEC-08 | Alto | Usuarios (UI) | Desactivar/eliminar no revocaba la cuenta Auth. | `auth.js` usa Edge `setUserActive`/`deleteUser`. | **BACKEND-OK / FRONT-PENDIENTE** — Edge v6 desplegada; `auth.js` sin publicar. Riesgo residual: el JWT ya emitido sigue válido hasta expirar (≈1 h). |
| SEC-09 | **Alto** | Ajustes / FEL | `tenant_isolation` (ALL) en `Organizations`: cualquier miembro leía y modificaba la configuración, incluidos `fel_api_key`/`fel_usuario_certificador`; la UI además guardaba la API key en `localStorage` en texto plano. | Migración `org_settings_fel_20261023`: secretos en `org_fel_secrets` (sin permisos de cliente), RPC `set_fel_credentials`/`get_fel_credentials_status` (solo ADMIN, nunca devuelve el secreto), trigger que intercepta escrituras heredadas, CHECK que impide guardar secretos en `Organizations`, políticas lectura=miembros / escritura=ADMIN·GERENTE / alta=ADMIN / borrado=SUPER_ADMIN, anon sin permisos. Frontend: sin secretos en localStorage (purga de copias antiguas), campos enmascarados. | **BACKEND-OK / FRONT-PENDIENTE** — `rls_lote2_org_fel.sql` **19/19 PASS** en producción. Ningún secreto FEL existía en BD antes del cambio (verificado). |
| SEC-10 | Medio | Auth | Protección de contraseñas filtradas desactivada; mínimo 6 caracteres en `admin-user-manager`. | Activar en Dashboard → Authentication → Providers → Email → *Prevent use of leaked passwords*. | **ABIERTO / NOT VERIFIED** — advisor `auth_leaked_password_protection` sigue activo; el conector no puede cambiar la configuración de Auth. |
| SEC-11 | Medio | Encuesta pública | XSS almacenado en `encuesta.html`. | `escHtml` en todos los campos. | **CORREGIDO-LOCAL** — prueba de regresión PASS; no publicado. |
| SEC-12 | Bajo | BD | `search_path` mutable. | Fijado. | **CORREGIDO**. |
| SEC-13 | Bajo | Usuarios | 1 fila con `passwordHash` legacy. | Vaciar tras migrar la cuenta. | **REQUIERE-APROBACIÓN**. |
| SEC-14 | Medio | Usuarios | El trigger `trg_fn_usuarios_protect_cols` no validaba INSERT: un ADMIN podía crear un perfil con el `auth_uid` de un usuario de otra empresa (alterando su `current_user_org_id()`) o con rol `Admin`. Además `v_role <> 'SUPER_ADMIN'` con `v_role` NULL no bloqueaba. | INSERT valida `auth_uid` ∈ `user_roles` de la misma org y prohíbe `Admin`; `IS DISTINCT FROM`; service_role sin cambios. | **CORREGIDO** — F14/F15/F17 PASS; regresión Lote 1 20/20 PASS tras el cambio. |
| SEC-15 | Medio | RPC | `admin_insert_usuario` (SECURITY DEFINER, `p_auth_uid` arbitrario) ejecutable por cualquier autenticado; sin uso. | EXECUTE revocado. | **CORREGIDO**. |
| SEC-16 | Bajo | Storage | anon puede **listar** el bucket público `logos-empresa` (enumeración de nombres de logos). | Logos son públicos por diseño; restringir listado si se desea. | **ABIERTO** (aceptable). |
| SEC-17 | Bajo | Edge | `sanitizeValue` rechaza textos legítimos que contengan "update ", "delete ", etc. (p. ej. empresa "Delete Corp"). | Quitar filtro por palabras (las consultas ya son parametrizadas). | **ABIERTO**. |

## Funcionales / integridad de datos

| ID | Sev. | Módulo | Defecto (causa raíz) | Corrección | Estado / evidencia |
|---|---|---|---|---|---|
| FN-01 | Alto | Freelancer | Insert anon rechazado y éxito mostrado igualmente. | RPC con token; éxito solo si el servidor confirma. | **CORREGIDO-LOCAL** — navegador: carga 5 preguntas vía RPC; con fallo simulado muestra error y no éxito. **Producción sigue con el defecto.** |
| FN-02 | Alto | Encuesta pública | `encuesta.html` leía tablas como anon → "No se encontró la encuesta". | RPC. | **CORREGIDO-LOCAL** — reproducido **en producción hoy** (enlace roto); versión local carga y valida. |
| FN-03 | Medio | Encuestas | `get_public_survey` sin opciones. | §I. | **CORREGIDO**. |
| FN-04 | Alto | Encuestas | 6 envíos Freelancer sin organización. | Asignados a `org_azyvion_001` (confirmado por el propietario). | **CORREGIDO** — 6 envíos en `org_azyvion_001`; T18/T19 PASS. |
| FN-05 | Alto | Registro | `register-crm` no creaba `sub_empresas`/`user_roles`. | v5 + backfill. | **BACKEND-OK** — v5 desplegada (fuente = repo); validaciones HTTP 400 verificadas; alta real **no ejecutada** (crearía cuentas en producción). |
| FN-07 | Medio | Usuarios | Reset/cambio de correo fallaban (id vs auth_uid). | Edge v6. | **BACKEND-OK** (invocación autenticada bloqueada). |
| FN-09 | Medio | Usuarios | No se podían crear Vendedores. | §J. | **CORREGIDO**. |
| FN-10 | Bajo | Contabilidad/POS | Lecturas/escrituras a `TransaccionesCRM` (no existe). | Eliminadas (los reportes ahora devuelven el error real). | **CORREGIDO-LOCAL**. |
| FN-11 | Medio | Comunidad/Ficha | 20 tablas con RLS y sin políticas. | Decidir si se migra o retira el módulo. | **ABIERTO** (no usadas vía Supabase). |
| FN-12 | Medio | Freelancer | `TestReclutamiento` sin política INSERT; guardado paralelo falla en silencio (no bloquea). | Retirar o RPC. | **ABIERTO** (bajo impacto; el envío real va por RPC). |
| FN-13 | **Alto** | Ajustes | `Organizations.iva_modalidad` no existía: cualquier guardado que la incluyera fallaba (42703) y caía en un "reintento" que solo guardaba 10 campos y respondía `ok:true`. | Columna añadida (CHECK `incluido/sobre/exento`); se eliminó el reintento parcial. | **BACKEND-OK / FRONT-PENDIENTE** — F13 PASS. |
| FN-14 | **Alto** | Ajustes | `guardarOrgConfig()` (perfil.js) **nunca llamaba a `saveOrgConfig`**: el botón quedaba en "Guardando…" y nada llegaba al servidor (solo localStorage del navegador). Evidencia: `Organizations` de Azyvion sin cambios desde 2026-09-29. Además el fallback `select().limit(1)` podía escribir en la empresa equivocada (SUPER_ADMIN). | Llamada añadida; siempre la org propia; errores informados. | **CORREGIDO-LOCAL** — prueba de regresión PASS; no publicado. |
| FN-15 | **Crítico (fiscal)** | POS / FEL | No hay integración FEL: "Probar conexión" respondía *"Conexión verificada… Credenciales autorizadas"* sin contactar a nadie, y con FEL habilitado (BD **o localStorage**) el ticket mostraba un **"UUID SAT" aleatorio, serie, número y enlace de verificación** como si fuera un DTE certificado. | Prueba de conexión responde honestamente "no implementada"; no se fabrica ningún DTE; el ticket indica "COMPROBANTE INTERNO — NO CERTIFICADO". | **CORREGIDO-LOCAL** — regresión PASS. Ninguna org tiene `fel_habilitado=true` en BD; no se puede saber si algún navegador lo activó vía localStorage e imprimió tickets falsos. |
| FN-16 | **Crítico (cálculo)** | Cotizaciones | Total guardado ≠ total mostrado: la UI usa IVA "incluido" por defecto (total = líneas) pero `_calcT` siempre sumaba IVA encima (total = líneas × 1.12). Además la UI leía `iva_pct`/`iva_modalidad` inexistentes en `EMPRESA` → IVA tomado del localStorage de cada navegador; IVA 0 % se convertía en 12 %. | `_calcT` aplica la misma regla que la UI; `EMPRESA.ivaModalidad`; redondeo idéntico a `numeric`. | **CORREGIDO-LOCAL** — 12 pruebas unitarias sobre el código real (UI = guardado en 3 modalidades); el código anterior guarda Q125.44 donde la UI muestra Q112. **Datos:** 2 cotizaciones con IVA tienen total inflado → REQUIERE-APROBACIÓN. |
| FN-17 | **Alto** | Cotizaciones | Editar: borraba todos los ítems y los reinsertaba en otra petición; si fallaba se perdían y se mostraba éxito. Crear: si fallaban los ítems quedaba cabecera vacía con `ok:true` (1 cotización con IVA sin ítems en producción). | RPC atómico `replace_cotizacion_items` (SECURITY INVOKER, recalcula totales de línea, valida cantidad/precio); compensación al crear. | **BACKEND-OK / FRONT-PENDIENTE** — `cotizaciones_integridad.sql` 7/7 PASS (incl. "un fallo no borra los ítems"). |
| FN-18 | Medio | Cotizaciones | Numeración max+1 en el navegador → duplicados concurrentes posibles. | Índice único `(organization_id, numero)` + reintento. | **BACKEND-OK / FRONT-PENDIENTE** — Q07 PASS; 0 duplicados existentes. |
| FN-19 | **Alto** | POS / Inventario | Descuento de stock leer-luego-escribir (ventas simultáneas pierden descuentos), truncado a 0 sin aviso (sobreventa), errores ignorados. Igual en "convertir cotización en venta". | RPC atómico `pos_mover_stock` (UPDATE condicional, todo o nada, devolución para compensar). | **BACKEND-OK / FRONT-PENDIENTE** — `pos_stock.sql` 8/8 PASS. |
| FN-20 | **Alto** | POS / Contabilidad | supabase-js no lanza excepciones: si fallaba el insert en `Transacciones` la venta quedaba "exitosa" sin ingreso contable. El monto registrado era el total enviado por el cliente. | Se revisa el error, se repone inventario y se informa; monto = total validado en servidor. | **CORREGIDO-LOCAL**. |
| FN-21 | **Alto** | Cotizaciones → Venta | El ingreso se escribía en `TransaccionesCRM` (inexistente): **ninguna conversión de cotización a venta llegó a Contabilidad**; la cotización quedaba Aprobada y se mostraba éxito. Sin protección contra doble conversión. | Escribe en `Transacciones` con verificación, guarda la referencia, bloquea doble conversión, compensa stock. | **CORREGIDO-LOCAL**. |
| FN-22 | Alto | Cotizaciones | `clienteId: ''` en columna uuid → crear una cotización sin elegir un cliente existente fallaba. | `null`. | **CORREGIDO-LOCAL**. |
| FN-23 | Medio | Customer 360 | La ficha agregaba cotizaciones con `cliente ILIKE %nombre%` ("Ana" ⊂ "Mariana") y doble codificación (nombres con espacios no coincidían). | Por `clienteId`; por nombre exacto solo si no hay `clienteId`. | **CORREGIDO-LOCAL** — sintaxis del filtro validada contra la API (HTTP 200 con comas, paréntesis y comillas). **Datos:** 3 cotizaciones apuntan a clientes eliminados (sin FK) → REQUIERE-APROBACIÓN. |
| FN-24 | Medio | Usuarios | 4 cuentas con `user_roles` en `org_azyvion_001` sin perfil en `Usuarios` (2 ADMIN, 2 VENDEDOR): las políticas basadas en `current_user_org_id()` les niegan Clientes/Inventario/Cotizaciones/etc. | Crear perfiles o retirar esas cuentas (decisión del propietario). | **REQUIERE-APROBACIÓN**. |
| FN-25 | Medio | Ficha / Actividades | Registrar una actividad sin fecha de seguimiento enviaba `''` a la columna `date` `fechaSeguimiento`: el guardado fallaba. | Se envía `null`. | **CORREGIDO-LOCAL** (Lote 7) — prueba unitaria. |
| ARC-01 | Medio | Arquitectura | Dos fuentes de organización (`current_user_org_id()` vía `Usuarios` y `get_my_org_id()` vía `user_roles`) y dos tablas de empresa. | Ver plan en `QA-REPORT.md` §Empresas. No se fusionan: son conceptos distintos. | **ABIERTO** (plan documentado). |

## No verificado
Flujos de UI autenticados (login, crear/editar en cada módulo, POS completo, PDF/correo de cotización, dashboard KPIs con sesión real) **no se ejecutaron**: requieren iniciar sesión con contraseñas reales contra producción. Ver `QA-REPORT.md`.

## Lote 3 — Rediseño (presentación)
| ID | Sev. | Defecto | Estado |
|---|---|---|---|
| UI-01 | Bajo | `dashboard.html` cargaba `dashboard-premium.css` inexistente (404 en cada carga). | CORREGIDO-LOCAL |
| UI-02 | Medio | Tres mecanismos de tema en conflicto: con el SO en oscuro y preferencia "claro" la interfaz quedaba mitad oscura. | CORREGIDO-LOCAL (motor único `data-theme`) |
| UI-03 | Bajo | El wordmark se recoloreaba con `filter: invert`. | CORREGIDO-LOCAL (placa blanca, logo original) |
| UI-04 | Bajo | Colores fijos en plantillas JS que no siguen el tema oscuro. | PARCIAL (patrones comunes corregidos) |
| CNT-01 | Bajo | Cifras de marketing no verificables en `login.html` ("Más de 1,000 equipos…", "38%", "4.9", "1K+"). | ABIERTO — decisión de contenido del propietario |
