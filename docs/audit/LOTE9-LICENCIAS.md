# Lote 9 — Licencias

## Estado (2026-10-23)
- Migración `20261023_11_licencias.sql`: **APLICADA en producción** el 2026-10-23 (registrada como `20261024023926 licencias_20261023`).
  Se otorgaron 6 licencias indefinidas a las empresas existentes.
  Sobre el estado real (todo revertido): licencias 14/14, redteam 17/17, embudo 12/12, lote2 19/19,
  cotizaciones 7/7, pos_stock 8/8, pos_ventas 61/61, pos_config 29/29, negocio 28/28.
- Edge Functions **desplegadas**: `login-crm` v8 (verify_jwt off), `register-crm` v6 (off) y `admin-user-manager` v7 (on).
  Prueba en vivo sin crear datos: una clave inexistente o mal escrita y un registro sin licencia responden 403
  con el contacto, y no se creó nada. El login con contraseña incorrecta sigue respondiendo 401.
- Frontend: publicado con el commit del Lote 9.

## Cómo funciona
- Cada empresa necesita una **licencia vigente**: estado ASIGNADA y sin vencer, según la fecha de Guatemala.
  Las empresas INTERNAL (Azyvion) están exentas.
- **La regla vive en la base de datos.** `current_user_org_id()`, `get_my_org_id()` y `pos_ctx()` devuelven
  vacío si la licencia no está vigente, y todas las políticas RLS y las funciones que dependen de ellas niegan
  el acceso. Ningún cambio en el navegador puede saltarse la licencia. Las 5 políticas que leían `Usuarios`
  directamente (`empleados` ×4 y `CategoriasInventario`) ahora usan `current_user_org_id()`.
- **Cuentas de la empresa:** todas las cuentas de una empresa con licencia pasan sin problema. La licencia
  limita los usuarios **activos**; lo controla el trigger `trg_usuarios_licencia`, que bloquea la licencia con
  `FOR UPDATE` para que dos altas simultáneas no se pasen del límite. Desactivar un usuario libera un cupo.
- **Registro:** el primer paso pide la licencia. `register-crm` la valida antes de crear nada y, después de crear
  la empresa, la reclama con un UPDATE condicional (`estado = DISPONIBLE`), así que dos registros con la misma
  clave no pueden ganar los dos. Si algo falla, la licencia vuelve a DISPONIBLE. El plan sale de la licencia.
  Se quitaron el selector de plan y el pago con tarjeta, que eran simulados y no cobraban.
- **Login:** después de validar la contraseña (para no revelar qué cuentas existen), si la empresa no tiene
  licencia vigente:
  - un vendedor o agente recibe 403 con el contacto de ventas, sin sesión;
  - un administrador ve el contacto y un campo para activar una licencia nueva. La sesión se guarda solo
    cuando la licencia queda activa.
- **Panel:** `mi_licencia()` al entrar. Sin licencia se muestra una pantalla de bloqueo con el contacto y, si es
  administrador, la activación. En los últimos 15 días se muestra un aviso de vencimiento. Se eliminó la
  "prueba de 4 días", que se contaba en `localStorage` y se podía saltar.
- **Súper admin:** pestaña SaaS › **Licencias**. Permite generar (con plan, usuarios, vencimiento opcional,
  cantidad y notas), copiar el código o el enlace `register.html?licencia=…`, asignar, editar o renovar, revocar
  y restaurar. Todo pasa por `licencia_admin()` y queda en `sub_auditoria`.
- **Contacto de ventas:** +502 5145 5610 · ventas@azyvion.com. Está en `licencia.js`, en `licencia_contacto()`
  (SQL) y en las Edge Functions.

## Empresas existentes (decisión del propietario: licencia a todas)
La migración da una licencia **indefinida** a cada empresa no interna. El límite de usuarios es el de su plan,
o 5 si no tiene plan, y nunca menor que los usuarios activos que ya tiene. Concreta (Enterprise) queda con 999.
Ojo: en `sub_empresas`, Concreta tiene `fecha_fin = 2026-10-29`. La licencia no copia esa fecha; si quieres que
venza, edítala en SaaS › Licencias.

## Pruebas
| Prueba | Resultado |
|---|---|
| `licencias.sql` (migración 11 + suite, revertido) | **14/14** (empresas existentes, acceso con y sin licencia, vencimiento, Azyvion exenta, límite de usuarios, alta sin licencia, generar y activar, reuso de clave, vendedor no activa, permisos, acciones del súper admin + auditoría, aislamiento, normalización) |
| Suites anteriores con la 11 encima | rls_lote2 19/19 · cotizaciones 7/7 · pos_stock 8/8 · pos_ventas 61/61 · pos_config 29/29 · negocio 28/28 · redteam 17/17 · embudo 12/12 · rls_regression 13/14 (T05 conocido) · productividad 18/19 |
| productividad P10 | Falla igual **sin** la migración 11: compara con `current_date` (UTC), que después de las 18:00 de Guatemala ya es el día siguiente. Es un defecto de la prueba, no de las licencias. |
| Unitarias | 96/96 |
| Interfaz (servidor simulado) | Registro: licencia inválida → contacto; flujo válido completo; el enlace con `?licencia=` llena la clave. Login: vendedor sin licencia → contacto; administrador → activación; la sesión se guarda solo al activar. Bloqueo del panel en tema claro y oscuro; pestaña de Licencias (generar, revocar, filtro de vencidas); móvil 375 px sin desbordamiento. |

## Despliegue (en este orden)
1. Aplicar `20261023_11_licencias.sql` y correr `tests/rls/licencias.sql` (14/14).
   Las empresas actuales reciben su licencia en la misma transacción, así que nadie pierde acceso.
2. Desplegar `login-crm` v8, `register-crm` v6 y `admin-user-manager` v7.
   Respaldo de las versiones actuales en `supabase/backup/20261023_lote9/`.
3. Publicar el frontend: `licencia.js`, `licencias-admin.js`, `login.html`, `register.html`, `dashboard.html` y `auth.js`.
4. Prueba manual: generar una licencia, registrarse con ella, revocarla y comprobar el bloqueo, y luego activar otra desde el bloqueo.

Reversión: `20261023_11_rollback.sql` restaura las funciones y políticas originales, copiadas de producción.
