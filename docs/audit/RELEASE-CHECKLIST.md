# Azyvion CRM — Checklist de release

## Puertas de producción (estado al 2026-10-23 UTC)

| Puerta | Estado | Evidencia / motivo |
|---|---|---|
| Sin defectos críticos/altos de seguridad abiertos | **FAIL** | Backend corregido, pero SEC-08/SEC-09 (frontend) sin publicar; SEC-10 abierto. |
| Autenticación y autorización en servidor verificadas | **PARCIAL** | RLS y RPC verificados; Edge con JWT real BLOQUEADO. |
| Aislamiento multi-tenant / RLS | **PASS** | 54/54 pruebas SQL en producción/ensayo. |
| Sin exposición de credenciales FEL | **PASS (BD)** / pendiente frontend | F01–F19; la UI publicada aún guarda la API key en localStorage si alguien la escribe. |
| Cálculos e integridad de datos | **FAIL hasta publicar** | Corregido localmente y probado; producción sigue con FN-16/17/19/20/21. |
| Flujos críticos E2E | **NOT VERIFIED** | Sin sesión de prueba. |
| Regresión requerida pasando | **PASS** | SQL 54/54, unitarias 22/22, sintaxis 34/34. |
| Migraciones reproducibles | **PARCIAL** | Las 5 migraciones de la auditoría están en `supabase/migrations/`; las 22 anteriores se aplicaron desde el panel y no están en el repo. |
| Deploy y rollback documentados | **PASS** | Este archivo + `*_rollback.sql` + respaldos. |
| Compatibilidad frontend/backend | **PASS** | Backend nuevo compatible con el frontend publicado (escrituras heredadas FEL interceptadas; inserts directos siguen permitidos por RLS) y con el frontend nuevo. |
| Sin errores críticos de ejecución | **NOT VERIFIED** | Páginas públicas sin errores de consola; dashboard autenticado no probado. |

**Veredicto: NOT READY.**

## Pasos para publicar (en orden)

Backend: **ya aplicado** (migraciones `org_settings_fel_20261023`, `revoke_admin_insert_usuario_20261023`, `cotizaciones_integridad_20261023`, `pos_stock_atomico_20261023`; Edge `admin-user-manager` v6 y `register-crm` v5).

1. Publicar en `azyvion/crm-prueba` (rama `main`, GitHub Pages) estos archivos:
   `auth.js`, `perfil.js`, `pos.js`, `cotizaciones.js`, `encuesta.html`, `Freelancer.html`
   y, opcionalmente, `tests/`, `.github/workflows/ci.yml`, `supabase/migrations/`, `docs/audit/`.
2. Esperar el despliegue de Pages y recargar con caché limpia (Ctrl+F5).
3. Prueba manual mínima (cuenta ADMIN de prueba):
   - Abrir `encuesta.html?token=ed4950ef-7464-43a7-9929-7dfd582aa3a2` → debe cargar; enviar una respuesta de prueba y verla en Encuestas.
   - Ajustes → cambiar el eslogan → Guardar → recargar → debe persistir. Escribir una API key FEL de prueba → Guardar → el campo queda vacío con "Guardada (••••1234)".
   - Cotización con IVA "incluido" de Q112 → guardada debe mostrar total Q112 (IVA Q12).
   - POS: vender más unidades de las disponibles → debe rechazar con "Existencia insuficiente".
   - Usuarios: desactivar un usuario de prueba → no debe poder iniciar sesión.
4. En Supabase Dashboard → Authentication → activar *Leaked password protection* (SEC-10).

## Rollback
- Frontend: volver a publicar las versiones anteriores (copias en `supabase/backup/20261023_lote2/` para `auth.js`, `perfil.js`, `pos.js`; las publicadas siguen en el historial de git de `azyvion/crm-prueba`).
- BD Lote 2: `supabase/migrations/20261023_02_rollback.sql`; los RPC de 04/05 se revierten con los `DROP` indicados en la cabecera de cada migración. Solo con aprobación: el rollback 02 vuelve a dejar las credenciales FEL legibles por los miembros.
- BD Lote 1: `supabase/migrations/20261023_01_rollback.sql` + esquema `audit_backup`.
- Edge: fuentes previas en `supabase/backup/20261023/`.
