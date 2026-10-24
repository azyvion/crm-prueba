// supabase/functions/register-crm/index.ts — v6 (Lote 9: licencias)
// v6: el registro exige una licencia DISPONIBLE y no vencida.
//  - { accion: "validar", licencia }  → solo consulta (no crea nada); con límite de intentos.
//  - registro: valida la licencia ANTES de crear la cuenta y la reclama con un UPDATE
//    condicional (estado = DISPONIBLE) después de crear la empresa: dos registros con la
//    misma clave no pueden ganar los dos. Si algo falla, la licencia vuelve a DISPONIBLE.
//  - El plan sale de la licencia (se ignora el plan que envíe el navegador).
// v5 (auditoría 2026-10-23)
// Basado en la v4 desplegada. Cambios [AUDIT FN-05]:
//  - Crea también la fila en sub_empresas (FK de user_roles y catálogos de inventario).
//  - Crea user_roles(ADMIN) para el usuario fundador → get_my_org_id() deja de ser NULL.
//  - Rollback completo y en orden inverso si cualquier paso falla.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const CONTACTO = { telefono: "+502 5145 5610", correo: "ventas@azyvion.com" };

// Igual que public.licencia_normalizar(): mayúsculas, sin espacios, guiones en su lugar
function normalizarLicencia(v: unknown): string | null {
  const c = String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return c.length === 15 && c.startsWith("AZV") ? `AZV-${c.slice(3, 7)}-${c.slice(7, 11)}-${c.slice(11, 15)}` : null;
}
// Fecha de hoy en Guatemala (UTC-6, sin horario de verano), igual que public.licencia_hoy()
function hoyGT(): string { return new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10); }

const intentos = new Map<string, { n: number; hasta: number }>();
function permitido(clave: string, max = 20): boolean {
  const ahora = Date.now(); const e = intentos.get(clave);
  if (!e || e.hasta < ahora) { intentos.set(clave, { n: 1, hasta: ahora + 15 * 60 * 1000 }); return true; }
  e.n++; return e.n <= max;
}

type Lic = { id: string; clave: string; plan_id: string | null; max_usuarios: number; vence_en: string | null; estado: string };
const SIN_LICENCIA = (msg: string) => json({ ok: false, sinLicencia: true, contacto: CONTACTO, error: msg }, 403);

// deno-lint-ignore no-explicit-any
async function buscarLicencia(sb: any, clave: string | null): Promise<{ lic?: Lic & { plan_nombre?: string }; error?: Response }> {
  if (!clave) return { error: SIN_LICENCIA("El código de licencia no es válido. Revisa que tenga el formato AZV-XXXX-XXXX-XXXX.") };
  const { data, error } = await sb.from("licencias").select("id, clave, plan_id, max_usuarios, vence_en, estado, sub_planes(nombre)").eq("clave", clave).maybeSingle();
  if (error) { console.error("[register-crm] LIC:", error.message); return { error: json({ ok: false, error: "No se pudo verificar la licencia. Intenta de nuevo." }, 503) }; }
  if (!data || data.estado !== "DISPONIBLE") return { error: SIN_LICENCIA("Esta licencia no existe o ya fue utilizada.") };
  if (data.vence_en && data.vence_en < hoyGT()) return { error: SIN_LICENCIA("Esta licencia está vencida.") };
  return { lic: { ...data, plan_nombre: data.sub_planes?.nombre ?? null } };
}

function slugify(txt: string): string {
  return txt
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 30);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  let body: {
    empresa?: { nombre?: string; correo?: string; pais?: string; sector?: string; tamano?: string };
    usuario?: { nombre?: string; cargo?: string; correo?: string; contrasena?: string };
    licencia?: string;
    accion?: string;
  };

  try { body = await req.json(); }
  catch { return json({ ok: false, error: "JSON inválido." }, 400); }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-ip";
  const claveLic = normalizarLicencia(body.licencia);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 0 — Solo validar la licencia (primer paso del formulario)
  if (body.accion === "validar") {
    if (!permitido("v:" + ip)) return json({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429);
    const r = await buscarLicencia(sb, claveLic);
    if (r.error) return r.error;
    const l = r.lic!;
    return json({ ok: true, licencia: { clave: l.clave, plan: l.plan_nombre, max_usuarios: l.max_usuarios, vence_en: l.vence_en } });
  }

  const { empresa, usuario } = body;
  if (!permitido("r:" + ip, 10)) return json({ ok: false, error: "Demasiados intentos. Espera 15 minutos." }, 429);

  if (!empresa?.nombre?.trim())  return json({ ok: false, error: "Nombre de empresa requerido." }, 400);
  if (!empresa?.correo?.trim() || !empresa.correo.includes("@"))  return json({ ok: false, error: "Correo de empresa inválido." }, 400);
  if (!usuario?.nombre?.trim())  return json({ ok: false, error: "Nombre del usuario requerido." }, 400);
  if (!usuario?.correo?.trim() || !usuario.correo.includes("@"))  return json({ ok: false, error: "Correo de usuario inválido." }, 400);
  if (!usuario?.contrasena || usuario.contrasena.length < 8)  return json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, 400);
  if (empresa.nombre.trim().length > 120 || usuario.nombre.trim().length > 120)
    return json({ ok: false, error: "Nombre demasiado largo." }, 400);

  // 0 — Licencia válida ANTES de crear nada
  const rLic = await buscarLicencia(sb, claveLic);
  if (rLic.error) return rLic.error;
  const lic = rLic.lic!;

  const correoUsuario = usuario.correo.trim().toLowerCase();

  // 1 — Correo duplicado
  const { data: existe } = await sb.from("Usuarios").select("id").eq("correo", correoUsuario).maybeSingle();
  if (existe) return json({ ok: false, error: "Este correo ya tiene una cuenta registrada." }, 409);

  // 2 — Crear en Supabase Auth
  const { data: authData, error: authErr } = await sb.auth.admin.createUser({
    email: correoUsuario,
    password: usuario.contrasena,
    email_confirm: true,
  });
  if (authErr) {
    const msg = authErr.message?.toLowerCase() ?? "";
    if (msg.includes("already")) return json({ ok: false, error: "Este correo ya tiene una cuenta registrada." }, 409);
    console.error("[register-crm] AUTH:", authErr.message);
    return json({ ok: false, error: "Error al crear el usuario (AUTH). Intenta de nuevo." }, 500);
  }
  const authUid = authData.user!.id;

  const ts = Date.now().toString(36);
  const orgId       = slugify(empresa.nombre.trim()) + "-" + ts;
  const usuarioSlug = slugify(usuario.nombre.trim()).substring(0, 18) + "-" + ts.slice(-6);
  const nowIso = new Date().toISOString();

  // Pila de reversión (se ejecuta en orden inverso)
  const undo: Array<() => Promise<unknown>> = [async () => { await sb.auth.admin.deleteUser(authUid); }];
  async function rollback(tag: string, e: { message?: string; code?: string } | null) {
    console.error(`[register-crm] ${tag}:`, e?.message, e?.code);
    for (const fn of undo.reverse()) { try { await fn(); } catch (_) { /**/ } }
    return json({ ok: false, error: `Error al registrar la empresa (${tag}). Intenta de nuevo.` }, 500);
  }

  // 3 — Organization (configuración de la empresa)
  const { error: orgErr } = await sb.from("Organizations").insert({
    id: orgId,
    nombre: empresa.nombre.trim(),
    correo: empresa.correo.trim().toLowerCase(),
    pais_codigo: empresa.pais ? empresa.pais.substring(0, 5) : "GT",
    moneda: "USD",
    iva_pct: 12,
    prefijo_cotizacion: "COT-",
    prefijo_ticket: "POS-",
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (orgErr) return await rollback("ORG", orgErr);
  undo.push(async () => { await sb.from("Organizations").delete().eq("id", orgId); });

  // 3b — [AUDIT FN-05] sub_empresas (requerida por FK de user_roles y catálogos)
  const { error: subErr } = await sb.from("sub_empresas").insert({
    id: orgId,
    nombre: empresa.nombre.trim(),
    correo: empresa.correo.trim().toLowerCase(),
    estado: "ACTIVE",
    plan_id: lic.plan_id,
    fecha_inicio: hoyGT(),
  });
  if (subErr) return await rollback("SUB", subErr);
  undo.push(async () => { await sb.from("sub_empresas").delete().eq("id", orgId); });

  // 3c — [Lote 9] Reclamar la licencia: solo si sigue DISPONIBLE (atómico)
  const { data: reclamada, error: licErr } = await sb.from("licencias")
    .update({ estado: "ASIGNADA", organization_id: orgId, asignada_en: nowIso, actualizada_en: nowIso })
    .eq("id", lic.id).eq("estado", "DISPONIBLE").select("id");
  if (licErr) return await rollback("LIC", licErr);
  if (!reclamada || reclamada.length !== 1) {
    for (const fn of undo.reverse()) { try { await fn(); } catch (_) { /**/ } }
    return SIN_LICENCIA("Esta licencia acaba de ser utilizada en otro registro.");
  }
  undo.push(async () => {
    await sb.from("licencias").update({ estado: "DISPONIBLE", organization_id: null, asignada_en: null, actualizada_en: new Date().toISOString() }).eq("id", lic.id);
  });

  // 4 — Usuario (rol legacy 'Admin' por check constraint)
  const { data: usrRow, error: usrErr } = await sb.from("Usuarios").insert({
    usuario: usuarioSlug,
    nombre: usuario.nombre.trim(),
    correo: correoUsuario,
    cargo: usuario.cargo?.trim() || "",
    rol: "Admin",
    activo: true,
    auth_uid: authUid,
    organization_id: orgId,
    permisos: { submenus: ["pos","clientes","prospectos","cotizaciones","inventario","crear-producto","encuestas","contabilidad","perfil","usuarios"] },
    "fechaReg": nowIso,
    tema: "claro",
    paginaInicio: "overview",
    densidadTabla: "comoda",
    copiarmeCotizaciones: false,
    alertaStockCritico: true,
  }).select("id").single();
  if (usrErr || !usrRow) return await rollback("USR", usrErr);
  undo.push(async () => { await sb.from("Usuarios").delete().eq("id", usrRow.id); });

  // 5 — [AUDIT FN-05] Rol de autorización real
  const { error: roleErr } = await sb.from("user_roles").insert({ user_id: authUid, role: "ADMIN", organization_id: orgId });
  if (roleErr) return await rollback("ROLE", roleErr);

  return json({ ok: true, organization_id: orgId, usuario: usuarioSlug, plan: lic.plan_nombre, licencia: { max_usuarios: lic.max_usuarios, vence_en: lic.vence_en } });
});
