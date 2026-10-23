# Azyvion CRM — Informe de QA (Lote 2, 2026-10-23 UTC)

Solo se cuenta como PASS lo que se ejecutó y cuyas aserciones pasaron. "No ejecutado" ≠ "pasó".

## 1. Resumen de ejecución

| Suite | Dónde se ejecutó | PASS | FAIL | Bloqueadas / no ejecutadas |
|---|---|---|---|---|
| `tests/rls/rls_regression.sql` bloque 1 (T01–T14) | Producción (revierte) | 14 | 0 | — |
| `tests/rls/rls_regression.sql` bloque 2 (T15–T20) | Producción (revierte) | 6 | 0 | — |
| `tests/rls/rls_lote2_org_fel.sql` (F01–F19) | Producción tras migración (revierte) | 19 | 0 | — |
| `tests/rls/cotizaciones_integridad.sql` (Q01–Q07) | Ensayo revertido con la migración | 7 | 0 | — |
| `tests/rls/pos_stock.sql` (S01–S08) | Ensayo revertido con la migración | 8 | 0 | — |
| `tests/unit/*.test.js` (node --test) | Local | 22 | 0 | — |
| `tests/check_syntax.js` | Local | 34 fuentes OK | 0 | — |
| Sondas HTTP contra la API real (anon) | Producción | 9 | 0 | — |
| Navegador: `encuesta.html` / `Freelancer.html` locales contra backend real | Local → producción (sin enviar datos) | 6 | 0 | Envío real no ejecutado (escribiría en producción; T20 cubre la ruta en BD) |
| Edge Functions con JWT de usuario (crear/desactivar/borrar/reset/email) | — | — | — | **BLOQUEADO**: no hay JWT de cuentas de prueba; no se usan contraseñas reales |
| `register-crm` alta completa + rollback | — | — | — | **BLOQUEADO**: crearía cuentas reales en producción; requiere staging |
| UI autenticada (todos los módulos) | — | — | — | **NO EJECUTADO**: requiere iniciar sesión |
| `tests/rls/run_all.sh` (runner para CI) | — | — | — | **NO EJECUTADO** (sin `psql`/URL de BD aquí); las mismas suites sí se ejecutaron vía conector |

Totales ejecutados: **SQL 54/54 PASS**, **unitarias 22/22 PASS**, **HTTP 9/9**, **navegador 6/6**. Fallos encontrados por las pruebas durante el lote y corregidos antes de aplicar: F07/F08 (guarda `NOT(NULL)` en las funciones FEL).

## 2. Sondas HTTP (anon key pública, producción)

| # | Petición | Esperado | Obtenido |
|---|---|---|---|
| E1 | `rpc/get_public_survey` token válido | encuesta | encuesta Freelancer, 5 preguntas |
| E2 | token inexistente | null | null |
| E3 | `Organizations?select=fel_api_key` | sin datos | `[]` |
| E4 | `Clientes` | sin datos | `[]` |
| E5 | `admin-user-manager` sin Authorization | 401 | 401 |
| E6 | `admin-user-manager` con JWT anon | 401 | 401 "Token inválido" |
| E7 | `register-crm` payload incompleto | 400 | 400 |
| E8 | `register-crm` contraseña corta | 400 | 400 |
| E9 | listar bucket `logos-empresa` | — | lista nombres (SEC-16, bajo) |

## 3. Módulos: implementado vs. faltante

| Módulo | Qué se verificó | Resultado | Implementado / faltante |
|---|---|---|---|
| Autenticación / usuarios | Código Edge v6/v5 desplegado = repo; RLS de `Usuarios`/`user_roles`; trigger de columnas protegidas | PASS (BD); Edge autenticada bloqueada | Desactivación real vía ban de Auth (requiere publicar `auth.js`). JWT emitido sigue válido hasta expirar. Contraseña mínima 6 en Edge de usuarios vs 8 en registro. |
| Aislamiento multi-tenant | 54 pruebas SQL (anon, AGENTE, ADMIN de otra org, SUPER_ADMIN) | PASS | Dos fuentes de organización (ARC-01). 4 cuentas sin perfil (FN-24). |
| Ajustes de empresa / FEL | Políticas, RPC, trigger, purga de localStorage | PASS | **FEL no está implementado** (no hay emisión ni certificación). Se dejó el almacenamiento seguro listo para una futura Edge Function con service_role. |
| Cotizaciones | Aritmética (UI = guardado), atomicidad de ítems, numeración única, validación | PASS tras corrección | Descuento global no expuesto en UI (siempre 0). PDF/correo no probados en navegador. |
| Inventario / POS | Descuento atómico, sobreventa, compensación, aislamiento | PASS tras corrección | Número de ticket POS sigue calculándose en el navegador (+localStorage): posibles duplicados concurrentes. Saldo de `CuentasBancarias` se actualiza leer-luego-escribir. |
| Contabilidad | Lectura de código y esquema | — | **No es contabilidad de partida doble**: `Transacciones` es un libro de caja de entrada simple (Ingreso/Egreso/monto). El "Libro Diario de partida doble" se **deriva** mostrando cada movimiento como un debe y un haber del mismo importe, por lo que siempre cuadra por construcción. No hay asientos, cuentas por cobrar ni por pagar. `PlanCuentas` existe pero no se usa para contabilizar. |
| Customer 360 | Agregación de cotizaciones | Corregido | 3 cotizaciones huérfanas (cliente eliminado, sin FK). Contactos/Notas/Actividades no probados con sesión. |
| Encuestas / formularios públicos | Carga, token inválido, validación, fallo sin falso éxito, escape HTML | PASS (local) | **Producción actual rota** (FN-02) hasta publicar. |
| Dashboard | — | NO VERIFICADO | KPIs no reconciliados con sesión real. |
| Clientes / Prospectos | Solo RLS (T05, T11–T13) | PASS (RLS) | CRUD por UI no probado. |
| Suscripciones (`sub_*`) | Políticas | — | Solo SUPER_ADMIN lee/escribe. `pasarela.js` actualiza `sub_empresas` desde el cliente: un ADMIN no puede (RLS) → revisar flujo de pago. |

## 4. Empresas: `Organizations` vs `sub_empresas` (ARC-01)

| Tabla | Concepto | Quién la usa | Relaciones |
|---|---|---|---|
| `Organizations` (6 filas) | Perfil del tenant: datos fiscales, membrete, IVA, prefijos, FEL | Ajustes, cotizaciones, POS, registro | Ninguna FK entrante; `org_fel_secrets` → `Organizations` |
| `sub_empresas` (7 filas) | Cuenta SaaS: plan, estado (TRIAL/ACTIVE/INTERNAL), ciclo, precio | Panel SUPER_ADMIN, pasarela, registro | FK entrantes: `user_roles`, `sub_suscripciones`, `sub_pagos`, `MarcasInventario`, `LineasInventario`, `FamiliasInventario`, `UnidadesNegocio`, `TiposProducto` |

Comparten la misma clave (`id`), pero **no son redundantes**: no se recomienda fusionarlas ni borrar ninguna. Diferencia actual: `org_concreta_001` existe en `sub_empresas` pero no en `Organizations` (su ADMIN la creará al guardar Ajustes; la política `org_insert` lo permite).

Plan propuesto (requiere aprobación, no ejecutado):
1. `register-crm`: crear `sub_empresas` **antes** que `Organizations`.
2. Crear la fila faltante de `Organizations` para `org_concreta_001` con valores por defecto.
3. Añadir FK `Organizations.id → sub_empresas.id` (1:1) tras validar en una copia.
4. Unificar la fuente de organización en `get_my_org_id()` (user_roles): migrar las políticas `tenant_isolation` que usan `current_user_org_id()` tabla por tabla, con la suite RLS como red de seguridad, después de resolver FN-24.

## 5. Datos que requieren decisión del propietario (no modificados)
1. 2 cotizaciones con IVA cuyo total guardado incluye IVA sumado encima (FN-16).
2. 1 cotización con IVA sin ítems (FN-17).
3. 3 cotizaciones con `clienteId` de clientes eliminados (FN-23).
4. 4 cuentas sin perfil en `Usuarios` (FN-24).
5. 1 fila con hash de contraseña legacy (SEC-13).

## 6. Rediseño Azyvion Enterprise (Lote 3)
Entorno: arnés local (copia de `dashboard.html` con `auth.js` sustituido por un stub sin backend; ningún dato real ni escritura).

| Prueba | Resultado |
|---|---|
| Sintaxis 34 fuentes + 22 pruebas unitarias/regresión | PASS |
| IDs (546), `onclick` (318) y llamadas `api.*` sin cambios | PASS |
| Selector claro/oscuro/sistema: atributo, clase heredada, `aria-pressed`, persistencia tras recargar | PASS |
| Tema oscuro: fondo, encabezado, tarjetas, tablas, barra lateral con colores de token | PASS (valores computados) |
| Escritorio 1024/1366 px — Resumen y Cotizaciones | PASS (visual) |
| Móvil 375 px — sin scroll horizontal, encabezado, selector compacto cicla modos, tema oscuro legible | PASS |
| Login con paleta nueva | PASS (visual) |
| Errores de consola nuevos atribuibles al rediseño | Ninguno (los observados vienen del stub del arnés) |
| Módulos con datos reales, modales, formularios, POS, PDF, Ficha 360 en ambos temas | BLOCKED (requiere sesión) |
| Tablet 768 px, contraste medido con herramienta | NOT RUN |
| Modo "sistema" siguiendo un cambio del SO en vivo | NOT RUN (lógica presente, no emulado) |
