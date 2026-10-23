# Azyvion CRM — Log de progreso de la auditoría

> Retomar desde aquí. No repetir el inventario del Lote 1: leer este archivo y `DEFECT-REGISTER.md`.

## Lote 1 — 2026-10-23 (Descubrir · Baseline · Seguridad crítica)

### Accesible en esta sesión
- Carpeta local `crm-prueba-main` (copia del repo; **sin acceso a git ni a GitHub Pages**).
- Proyecto Supabase `dwtykzporgjjvdustjfq` vía conector: esquema, políticas, funciones, Edge Functions, advisors, SQL.
- **No** se usó navegador ni se probó la UI en vivo; **no** se desplegó nada.

### Inventario (resumen)
- Frontend estático: `index.html` (landing), `login.html`, `register.html`, `dashboard.html` (8,075 líneas, núcleo) + módulos JS (`auth.js` 2,765 líneas = capa de datos/`_dispatch`, `clientes.js`, `prospectos.js`, `inventario.js`, `cotizaciones.js`, `contabilidad.js`, `pos.js`, `encuestas.js`, `empleados.js`, `ficha-pro.js`, `perfil.js`, `overview.js`, `pasarela.js`, `vendedor.js`, `ai.js`), páginas públicas `encuesta.html`, `Freelancer.html`, `apps.html`.
- BD: 57 tablas en `public`, todas con RLS; 20 sin políticas (deny-all). 16 funciones (15 SECURITY DEFINER). 3 buckets públicos. 22 migraciones registradas.
- Edge Functions: `login-crm` (verify_jwt off, login por usuario → Supabase Auth + migración legacy), `admin-user-manager` (verify_jwt on), `register-crm` (verify_jwt off, alta pública de empresas), `ai-azyvion` (solo local).
- Autorización: `user_roles` + `get_my_org_id()/get_my_role()/is_super_admin()`; coexisten políticas basadas en `Usuarios` (`current_user_org_id()`).
- Sin secretos de servidor en el frontend: solo claves anon/publishable (correcto).
- Sintaxis: todos los `.js` y scripts inline de los `.html` pasan `node --check`.

### Cambios hechos (archivos)
| Archivo | Tipo | Estado |
|---|---|---|
| `encuesta.html` | Corrección FN-02, SEC-11 | Local, listo para publicar |
| `Freelancer.html` | Corrección FN-01 | Local, listo para publicar |
| `auth.js` | SEC-08 (eliminar/desactivar vía Edge) | Local — **publicar después** de desplegar Edge v6 |
| `supabase/functions/admin-user-manager/index.ts` | v6 (SEC-02, SEC-03, FN-07, SEC-08) | Local, **no desplegado** |
| `supabase/functions/register-crm/index.ts` | v5 (FN-05) | Local, **no desplegado** |
| `supabase/migrations/20261023_01_security_hardening.sql` | §A–§J | Validada en ensayo revertido, **no aplicada** |
| `supabase/migrations/20261023_01_rollback.sql` | Reversión | — |
| `tests/rls/rls_regression.sql` | 14 pruebas RLS/tenant | Ejecutable con seguridad en producción (siempre revierte) |

### Evidencia QA (ejecutada)
| Prueba | Resultado |
|---|---|
| `rls_regression.sql` contra producción actual | 6 PASS / 8 FAIL (T01, T02, T03, T04, T06, T07, T09, T14) |
| Migración + `rls_regression.sql` en transacción revertida | **14 PASS / 0 FAIL** |
| §J (crear perfil Vendedor) en transacción revertida | PASS |
| RPC `get_public_survey` / `submit_public_survey` como anon (revertido) | PASS |
| `node --check` en todos los JS + scripts inline | PASS |
| `esbuild` (sintaxis TS) de las 2 Edge Functions modificadas | PASS |
| Verificación post-ensayo de que producción no cambió | PASS (políticas originales presentes) |
| Pruebas E2E de UI | **NO EJECUTADAS** |

### Orden de despliegue (cuando se apruebe)
1. Aplicar `20261023_01_security_hardening.sql`.
2. Ejecutar `tests/rls/rls_regression.sql` → debe dar 14/14 (ahora sí sobre el estado real).
3. Desplegar Edge `admin-user-manager` v6 y `register-crm` v5.
4. Publicar `encuesta.html`, `Freelancer.html`, `auth.js` (git push a GitHub Pages).
5. Prueba manual: abrir enlace de encuesta → enviar → verla en el CRM; crear/desactivar/eliminar un usuario de prueba; registrar empresa de prueba y crear una marca.

### Puertas de release
| Puerta | Estado |
|---|---|
| Inventario de módulos | Parcial (estructura sí; flujos funcionales no) |
| Flujos críticos E2E | NOT VERIFIED |
| Sin defectos críticos/altos abiertos | **FAIL** (correcciones listas, no aplicadas) |
| Auth y autorización backend | FAIL → corrección lista |
| RLS / aislamiento multi-tenant | FAIL en producción; PASS en ensayo |
| Sin secretos expuestos | PASS (frontend); SEC-09 abierto (FEL) |
| Integridad de datos / cálculos financieros | NOT VERIFIED |
| Tests automáticos | Parcial (RLS) |
| Migraciones reproducibles | Parcial (22 migraciones aplicadas desde el panel; los .sql del repo no coinciden con el historial) |
| Deploy / rollback documentado | Parcial (este archivo + rollback.sql) |

**Veredicto Lote 1: NOT READY.**

## Lote 1b — 2026-10-23 (aplicación en producción)

| Paso | Resultado |
|---|---|
| Respaldo `audit_backup` (124 políticas, 16 funciones, 69 permisos, 42 filas de encuesta, 11 roles) + Edge v5/v4 en `supabase/backup/20261023/` | ✅ |
| Migración `security_hardening_20261023` aplicada (1 transacción) | ✅ |
| `rls_regression.sql` bloque 1 sobre producción | ✅ **14/14 PASS** (antes 6/14) |
| `rls_regression.sql` bloque 2 (positivos ADMIN, encuesta, anon submit) | ✅ **6/6 PASS** |
| Advisors: `function_search_path_mutable` y RPC `admin_create_usuario_profile` ejecutable | ✅ desaparecieron |
| Deploy Edge `admin-user-manager` v6 / `register-crm` v5 | ⛔ **Bloqueado por permisos de la sesión** — pendiente |
| Publicar `auth.js`, `encuesta.html`, `Freelancer.html` | ⏳ Pendiente (usuario, git push) |

Advisors restantes (aceptados): funciones helper SECURITY DEFINER usadas por RLS (`get_my_org_id`, etc.) devuelven NULL para anon; `get_public_survey`/`submit_public_survey` son públicas por diseño; `admin_insert_usuario` (usa `auth.uid()`, sin uso en frontend) → revisar en Lote 2. 20 tablas sin políticas (deny-all) y protección de contraseñas filtradas siguen abiertas.

### Siguiente acción exacta
Desplegar Edge `admin-user-manager` v6 y `register-crm` v5; publicar los 3 archivos de frontend; después, Lote 2: SEC-09 (Organizations/FEL), ARC-01, y auditoría funcional de Cotizaciones (totales/impuestos), Inventario (stock) y Contabilidad.

## Lote 2 — 2026-10-23 UTC (verificación del checkpoint · FEL/Ajustes · QA funcional)

### Checkpoint verificado (evidencia en vivo, no histórica)
| Afirmación histórica | Verificado |
|---|---|
| `sala_anon_select` eliminada | ✅ 0 políticas `sala_anon*`; anon HTTP → `[]` |
| Esquema `audit_backup` | ✅ existe |
| Edge `admin-user-manager` v6 / `register-crm` v5 desplegadas | ✅ versiones 6/5 ACTIVE; la fuente desplegada coincide con el repo (corrige el "bloqueado" de Lote 1b) |
| 6 envíos Freelancer en `org_azyvion_001` | ✅ 6 envíos, encuesta y envíos en la org |
| RLS 20/20 | ✅ re-ejecutado: 14/14 + 6/6 |
| Frontend publicado | ❌ **No**. Producción = `azyvion/crm-prueba` (no `CRM-AZYVION`, que está desactualizado desde el 01-oct). Solo difieren los archivos modificados por la auditoría; `encuesta.html` en producción sigue roto (reproducido en navegador). |

### Cambios aplicados en producción (BD)
| Migración | Contenido | Pruebas |
|---|---|---|
| `org_settings_fel_20261023` (`20261023_02_*`) | SEC-09, FN-13, SEC-14 | 19/19 + regresión 20/20 |
| `revoke_admin_insert_usuario_20261023` (`_03_`) | SEC-15 | — |
| `cotizaciones_integridad_20261023` (`_04_`) | FN-17, FN-18 | 7/7 (ensayo) |
| `pos_stock_atomico_20261023` (`_05_`) | FN-19 | 8/8 (ensayo) |
Respaldo previo: `audit_backup.lote2_policies`, `audit_backup.lote2_functions`. Todas aditivas salvo el reemplazo de la política `tenant_isolation` de `Organizations`.

### Cambios locales (sin publicar)
`auth.js`, `perfil.js`, `pos.js`, `cotizaciones.js` (+ los 3 de Lote 1). Copias previas en `supabase/backup/20261023_lote2/`. Nuevos: `tests/unit/*`, `tests/check_syntax.js`, `tests/rls/{rls_lote2_org_fel,cotizaciones_integridad,pos_stock}.sql`, `tests/rls/run_all.sh`, `.github/workflows/ci.yml`, `docs/audit/QA-REPORT.md`, `docs/audit/RELEASE-CHECKLIST.md`.

### Bloqueos
- Sin git/credenciales de GitHub en esta carpeta → no se puede publicar el frontend.
- Sin JWT de cuentas de prueba → Edge Functions autenticadas no probadas; UI autenticada no probada.
- Configuración de Auth (contraseñas filtradas) no accesible por el conector.

### Siguiente acción exacta
1. Publicar los 6 archivos de frontend (ver `RELEASE-CHECKLIST.md`) y hacer la prueba manual mínima.
2. Activar protección de contraseñas filtradas.
3. Decidir sobre los datos de `QA-REPORT.md` §5.
4. Proveer un proyecto staging o cuentas de prueba (con sesión) para E2E de UI y Edge.

**Veredicto Lote 2: NOT READY.**

## Lote 3 — 2026-10-23 UTC (Rediseño Azyvion Enterprise)
Trabajo en la misma carpeta por decisión del propietario (sin clon ni rama). Respaldo previo: `supabase/backup/20261023_redesign/`. Nada publicado.
- Nuevos: `azyvion-theme.js`, `azyvion-enterprise.css`, `docs/design/AZYVION-ENTERPRISE-DESIGN-SPEC.md`.
- Modificados (solo presentación / hooks de tema): `dashboard.html` (+6/−14: motor de tema, CSS final, sin el enlace roto a `dashboard-premium.css`, `theme-color`), `perfil.js` (+5/−2: switch de Perfil → `AzTheme`), `overview.js` (+3: gráficas usan el tema resuelto), `login.html`, `register.html`, `encuesta.html`, `Freelancer.html` (solo valores de `:root`).
- Sin cambios en BD, Edge, Auth, RLS, cálculos ni consultas. `dashboard.css` intacto; 546 IDs y 318 `onclick` de `dashboard.html` sin cambios.

## Lote 4 — 2026-10-23 UTC (POS: rediseño operativo y garantías transaccionales)
Detalle completo, orden de despliegue y pendientes: [`POS-LOTE4.md`](./POS-LOTE4.md). Respaldo previo: `supabase/backup/20261023_lote4/`. **Nada aplicado en producción ni publicado.**
- Nueva migración `20261023_06_pos_ventas.sql` (+ rollback): ventas, pagos, devoluciones, movimientos de caja y auditoría; funciones transaccionales e idempotentes; cierres inmutables; protección de `permisos`/`sucursal_id` de usuarios.
- Frontend: `pos.js` reescrito, `pos-calc.js`, `pos.css`, `auth.js` (RPC), permisos POS en el formulario de usuarios.
- Pruebas: SQL 61/61 (ensayo revertido), suites previas 14/14·19/19·7/7·8/8, unitarias 46/46, interfaz con servidor simulado (red caída, doble clic, móvil, oscuro).
- Abiertos: concurrencia real y E2E autenticado en staging; tarjeta y FEL requieren integraciones externas.

## Lote 5 — 2026-10-23 UTC (Configuración del POS por empresa)
Detalle en [`POS-LOTE4.md`](./POS-LOTE4.md) (sección Lote 5). Migración `20261023_07_pos_config.sql` **no aplicada**; frontend **no publicado**. Pruebas: SQL 29/29 + 61/61 + suites previas, unitarias 53/53, interfaz en arnés.

## Lote 6 — 2026-10-23 UTC (Negocio: reportes, compras, kardex, seguimiento)
Detalle en [`POS-LOTE4.md`](./POS-LOTE4.md) (sección Lote 6). Migración `20261023_08_negocio.sql` **no aplicada**; frontend **no publicado**. Pruebas: SQL 28/28 + suites previas, unitarias 60/60, interfaz en arnés.

## Lote 7 — 2026-10-23 (Productividad)
Detalle completo en `docs/audit/LOTE7-PRODUCTIVIDAD.md`.

- **Estado real verificado:** 06–08 ya aplicadas en producción (fuera del historial de migraciones); el frontend publicado = línea base local (Lotes 1–6 publicados). Uso real del POS nuevo (1 caja abierta, 1 venta). `org_azyvion_001` con 0 clientes.
- **Git local** creado (sin remoto): `ed1d793` línea base → commits del Lote 7.
- **Nuevo:** tareas/calendario/recordatorios, plantillas y redactor de mensajes con registro, importación CSV, auditoría general, metas por vendedor, alerta de stock mínimo, ventas pendientes del POS en el servidor. Corrección FN-25.
- **Pruebas:** SQL 19/19 (solo 09 sobre el estado real) + suites previas sin regresiones; unitarias 71/71; arnés de interfaz OK.
- **Siguiente acción exacta:** aprobación para aplicar `20261023_09_crm_productividad.sql` y publicar los 8 archivos listados en el documento del lote.
- **Aplicación (aprobada por el propietario):** `20261023_09_crm_productividad.sql` aplicada en producción en una sola transacción y registrada en el historial (`20261023200000`). `productividad.sql` sobre producción: **19/19 PASS**. Advisors: solo hallazgos esperados (tablas deny-all de auditoría y metas, funciones SECURITY DEFINER con verificación interna) y SEC-10 sigue abierto. Pendiente: publicar los 8 archivos del frontend.

## Auditoría de seguridad — 2026-10-23 (detección + intrusión + corrección)
Detalle en `docs/audit/SECURITY-REVIEW-2026-10-23.md`.
- **Red-team** (`tests/rls/redteam_productividad.sql`): atacante de otra empresa + agente + anon contra `org_azyvion_001`. **17/17 ataques bloqueados** (cross-tenant, IDOR FEL, escalada, suplantación, auditoría inmutable, sin fuga de contraseñas). Sin rastro en producción.
- **SEC-18 (Media) corregido:** inyección de fórmulas en CSV (`descargarCSV`). Prueba `tests/unit/security.test.js`. Unitarias 73/73.
- **Abierto:** SEC-10 (contraseñas filtradas, Auth — propietario), SEC-16/17 (bajas, aceptadas).
