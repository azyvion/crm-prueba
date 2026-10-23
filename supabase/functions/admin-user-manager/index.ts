// supabase/functions/admin-user-manager/index.ts — v6 (auditoría 2026-10-23)
// Basado en la v5 desplegada. Cambios marcados con [AUDIT …]:
//  SEC-02  createUser ya NO reutiliza cuentas Auth existentes (antes reseteaba la
//          contraseña de un usuario de OTRA empresa, borraba sus roles y podía
//          eliminar su cuenta en el rollback).
//  SEC-03  reset/email/delete validan el rol REAL del objetivo (user_roles) y su
//          organización; ADMIN no puede operar sobre ADMIN/SUPER_ADMIN.
//  FN-07   user_id acepta Usuarios.id o auth_uid (el frontend envía auth_uid).
//  SEC-08  nueva acción setUserActive: desactivar = bloquear la cuenta en Auth.
//  FN-08   rollback solo borra la cuenta Auth si se creó en esta misma llamada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "*";

const ROLE_MAP: Record<string, string> = {
  Admin: "ADMIN",
  Gerente: "GERENTE",
  Agente: "AGENTE",
  Vendedor: "VENDEDOR",
};

const ALLOWED_CALLER_ROLES = ["SUPER_ADMIN", "ADMIN"];
const ADMIN_CREATABLE_ROLES = ["GERENTE", "AGENTE", "VENDEDOR"];
const SUPER_ADMIN_CREATABLE_ROLES = ["ADMIN", "GERENTE", "AGENTE", "VENDEDOR"];
const PRIVILEGED_ROLES = ["SUPER_ADMIN", "ADMIN"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN_FOREVER = "876000h"; // ~100 años

type SB = ReturnType<typeof createClient>;

function corsHeaders(origin: string | null): HeadersInit {
  const allowedOrigin = ALLOWED_ORIGIN === "*" ? "*" : origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, apikey, x-client-info",
    "Access-Control-Max-Age": "86400",
  };
}

function optionsResponse(origin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function ok(data: unknown, origin: string | null, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function err(message: string, origin: string | null, status: number): Response {
  console.error(`[admin-user-manager] ERROR ${status}: ${message}`);
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function sanitizeValue(value: unknown): string {
  if (typeof value !== "string") return "";
  const dangerous = /service_role|service_key|anon_key|select\s|insert\s|update\s|delete\s|drop\s|alter\s|--\s|\/\*/i;
  if (dangerous.test(value)) throw new Error("Payload contiene contenido no permitido.");
  return value.trim();
}

/* [AUDIT FN-07] Resolver el usuario objetivo por Usuarios.id o por auth_uid. */
interface Target { id: string; auth_uid: string | null; organization_id: string | null; rol: string | null }
async function resolveTarget(sb: SB, rawId: string): Promise<Target | null> {
  if (!UUID_RE.test(rawId)) return null;
  const { data, error } = await sb
    .from("Usuarios")
    .select("id, auth_uid, organization_id, rol")
    .or(`id.eq.${rawId},auth_uid.eq.${rawId}`)
    .limit(2);
  if (error || !data || data.length !== 1) return null;
  const t = data[0] as Record<string, unknown>;
  return {
    id: String(t.id),
    auth_uid: t.auth_uid ? String(t.auth_uid) : null,
    organization_id: t.organization_id ? String(t.organization_id) : null,
    rol: t.rol ? String(t.rol) : null,
  };
}

/* [AUDIT SEC-03] Roles reales del objetivo (todas las filas, incluida SUPER_ADMIN global). */
async function targetRoles(sb: SB, authUid: string | null): Promise<string[]> {
  if (!authUid) return [];
  const { data } = await sb.from("user_roles").select("role").eq("user_id", authUid);
  return (data || []).map((r: Record<string, unknown>) => String(r.role));
}

/* [AUDIT SEC-03] Regla única de autorización sobre un usuario objetivo. */
function authorizeOnTarget(
  callerRole: string, callerOrgId: string | null, callerAuthUid: string,
  target: Target, roles: string[],
): string | null {
  if (target.auth_uid && target.auth_uid === callerAuthUid) return "No puedes realizar esta acción sobre tu propia cuenta.";
  if (roles.includes("SUPER_ADMIN") && callerRole !== "SUPER_ADMIN") return "No autorizado sobre un SUPER_ADMIN.";
  if (callerRole === "ADMIN") {
    if (!target.organization_id || target.organization_id !== callerOrgId) return "No puedes operar sobre usuarios de otra organización.";
    if (roles.some((r) => PRIVILEGED_ROLES.includes(r)) || target.rol === "Admin") return "ADMIN no puede operar sobre otro ADMIN.";
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return optionsResponse(origin);
  if (req.method !== "POST") return err("Método no permitido.", origin, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return err("No autenticado.", origin, 401);
  const userJwt = authHeader.replace("Bearer ", "").trim();

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );

  const { data: { user: callerAuthUser }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !callerAuthUser) return err("Token inválido.", origin, 401);
  const callerAuthUid = callerAuthUser.id;

  const { data: isSuperAdmin, error: saErr } = await supabaseUser.rpc("is_super_admin");
  if (saErr) return err("No se pudo verificar permisos.", origin, 500);

  let callerRole: string;
  let callerOrgId: string | null = null;

  if (isSuperAdmin === true) {
    callerRole = "SUPER_ADMIN";
  } else {
    const { data: orgId, error: orgErr } = await supabaseUser.rpc("get_my_org_id");
    if (orgErr || !orgId) return err("Tu usuario no tiene una organización asignada.", origin, 403);
    callerOrgId = String(orgId);
    const { data: role, error: roleErr } = await supabaseUser.rpc("get_my_role", { p_org_id: callerOrgId });
    if (roleErr || !role) return err("Tu usuario no tiene un rol asignado.", origin, 403);
    callerRole = String(role);
  }

  if (!ALLOWED_CALLER_ROLES.includes(callerRole)) return err(`Rol no autorizado: ${callerRole}`, origin, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return err("Payload JSON inválido.", origin, 400); }

  let action: string;
  try { action = sanitizeValue(body.action); }
  catch { return err("Payload contiene contenido no permitido.", origin, 400); }
  console.log(`[admin-user-manager] caller=${callerAuthUid} role=${callerRole} action=${action}`);

  switch (action) {
    case "createUser":        return await handleCreateUser(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "resetUserPassword": return await handleResetPassword(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "updateUserEmail":   return await handleUpdateEmail(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "deleteUser":        return await handleDeleteUser(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "setUserActive":     return await handleSetActive(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    default: return err(`Acción desconocida: ${action}`, origin, 400);
  }
});

/* ── CREATE USER ─────────────────────────────────────────────────────── */
async function handleCreateUser(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, supabaseAdmin: SB, origin: string | null
): Promise<Response> {
  let email: string, password: string, usuario: string, nombre: string;
  let rolLegacy: string, correo: string, telefono: string, cargo: string;

  try {
    email     = sanitizeValue(body.email).toLowerCase();
    usuario   = sanitizeValue(body.usuario);
    nombre    = sanitizeValue(body.nombre);
    rolLegacy = sanitizeValue(body.rol);
    correo    = sanitizeValue(body.correo ?? body.email);
    telefono  = sanitizeValue(body.telefono ?? "");
    cargo     = sanitizeValue(body.cargo ?? "");
    password  = typeof body.password === "string" ? body.password : "";
  } catch (_e) {
    return err("Payload contiene contenido no permitido.", origin, 400);
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Email inválido.", origin, 400);
  if (!password || password.length < 6) return err("Contraseña mínimo 6 caracteres.", origin, 400);
  if (!usuario) return err("Campo usuario obligatorio.", origin, 400);
  if (!nombre)  return err("Campo nombre obligatorio.", origin, 400);

  if (!Object.prototype.hasOwnProperty.call(ROLE_MAP, rolLegacy))
    return err(`Rol inválido: '${rolLegacy}'. Aceptados: ${Object.keys(ROLE_MAP).join(", ")}.`, origin, 400);
  const rolInterno = ROLE_MAP[rolLegacy];

  if (callerRole === "ADMIN" && !ADMIN_CREATABLE_ROLES.includes(rolInterno))
    return err(`ADMIN no puede crear rol ${rolInterno}.`, origin, 403);
  if (callerRole === "SUPER_ADMIN" && !SUPER_ADMIN_CREATABLE_ROLES.includes(rolInterno))
    return err(`SUPER_ADMIN no puede crear rol ${rolInterno}.`, origin, 403);

  let targetOrgId: string;
  if (callerRole === "ADMIN") {
    if (!callerOrgId) return err("ADMIN sin organización.", origin, 403);
    targetOrgId = callerOrgId;
  } else {
    let requestedOrg: string;
    try { requestedOrg = sanitizeValue(body.organization_id); }
    catch { return err("organization_id inválido.", origin, 400); }
    if (!requestedOrg) return err("SUPER_ADMIN debe indicar organization_id.", origin, 400);
    const { data: orgExists, error: orgCheckErr } = await supabaseAdmin
      .from("sub_empresas").select("id").eq("id", requestedOrg).maybeSingle();
    if (orgCheckErr || !orgExists) return err(`Organización no encontrada: ${requestedOrg}`, origin, 404);
    targetOrgId = requestedOrg;
  }

  const { data: existingUsuario, error: existingErr } = await supabaseAdmin
    .from("Usuarios").select("id").eq("usuario", usuario).maybeSingle();
  if (existingErr) return err("Error verificando usuario.", origin, 500);
  if (existingUsuario) return err("Ya existe un usuario con ese nombre.", origin, 409);

  // [AUDIT SEC-02] Nunca reutilizar ni modificar una cuenta Auth existente.
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: nombre },
  });
  if (authErr || !authData?.user) {
    const msg = (authErr?.message || "").toLowerCase();
    const code = (authErr as unknown as { code?: string })?.code;
    if (code === "email_exists" || msg.includes("already")) {
      return err("Ese correo ya tiene una cuenta. Usa otro correo o contacta a soporte.", origin, 409);
    }
    return err("No se pudo crear la cuenta de acceso.", origin, 500);
  }
  const newAuthUid = authData.user.id;   // creada en esta llamada → se puede revertir

  const { data: insertData, error: insertErr } = await supabaseAdmin.rpc(
    "admin_create_usuario_profile",
    {
      p_caller_auth_uid: callerAuthUid,
      p_auth_uid: newAuthUid,
      p_usuario: usuario,
      p_nombre: nombre,
      p_rol_legacy: rolLegacy,
      p_correo: correo || email,
      p_telefono: telefono || "",
      p_cargo: cargo || "",
      p_organization_id: targetOrgId,
    }
  );
  if (insertErr || !insertData) {
    await supabaseAdmin.auth.admin.deleteUser(newAuthUid);
    return err(`No se pudo crear el perfil: ${insertErr?.message || "sin datos"}`, origin, 500);
  }
  const newUsuarioId = String(insertData);

  const { error: roleInsertErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: newAuthUid, role: rolInterno, organization_id: targetOrgId });
  if (roleInsertErr) {
    await supabaseAdmin.from("Usuarios").delete().eq("id", newUsuarioId);
    await supabaseAdmin.auth.admin.deleteUser(newAuthUid);
    return err(`Error asignando rol: ${roleInsertErr.message}`, origin, 500);
  }

  return ok({ id: newUsuarioId, auth_uid: newAuthUid, usuario, nombre, rol: rolLegacy, correo: correo || email, organization_id: targetOrgId }, origin, 201);
}

/* ── Carga + autorización común para acciones sobre un usuario existente ── */
async function loadAuthorizedTarget(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, sb: SB,
): Promise<{ target?: Target; error?: [string, number] }> {
  let rawId: string;
  try { rawId = sanitizeValue(body.user_id); }
  catch { return { error: ["user_id inválido.", 400] }; }
  if (!rawId) return { error: ["Campo user_id obligatorio.", 400] };
  const target = await resolveTarget(sb, rawId);
  if (!target) return { error: ["Usuario no encontrado.", 404] };
  const roles = await targetRoles(sb, target.auth_uid);
  const denial = authorizeOnTarget(callerRole, callerOrgId, callerAuthUid, target, roles);
  if (denial) return { error: [denial, 403] };
  return { target };
}

/* ── RESET PASSWORD ──────────────────────────────────────────────────── */
async function handleResetPassword(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, supabaseAdmin: SB, origin: string | null
): Promise<Response> {
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length < 6) return err("Contraseña mínimo 6 caracteres.", origin, 400);
  const r = await loadAuthorizedTarget(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin);
  if (r.error) return err(r.error[0], origin, r.error[1]);
  const t = r.target!;
  if (!t.auth_uid) return err("Usuario sin cuenta de acceso vinculada.", origin, 409);
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(t.auth_uid, { password });
  if (updateErr) return err("Error actualizando contraseña.", origin, 500);
  return ok({ user_id: t.id }, origin, 200);
}

/* ── UPDATE EMAIL ────────────────────────────────────────────────────── */
async function handleUpdateEmail(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, supabaseAdmin: SB, origin: string | null
): Promise<Response> {
  let email: string;
  try { email = sanitizeValue(body.email).toLowerCase(); }
  catch { return err("Payload inválido.", origin, 400); }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Email inválido.", origin, 400);
  const r = await loadAuthorizedTarget(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin);
  if (r.error) return err(r.error[0], origin, r.error[1]);
  const t = r.target!;
  if (!t.auth_uid) return err("Usuario sin cuenta de acceso vinculada.", origin, 409);
  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(t.auth_uid, { email, email_confirm: true });
  if (updateErr) return err("Error actualizando email (¿ya está en uso?).", origin, 409);
  await supabaseAdmin.from("Usuarios").update({ correo: email }).eq("id", t.id);
  return ok({ user_id: t.id, email }, origin, 200);
}

/* ── SET ACTIVE (desactivar = bloquear acceso real) ─────────────────── */
async function handleSetActive(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, supabaseAdmin: SB, origin: string | null
): Promise<Response> {
  if (typeof body.activo !== "boolean") return err("Campo activo (boolean) obligatorio.", origin, 400);
  const activo = body.activo as boolean;
  const r = await loadAuthorizedTarget(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin);
  if (r.error) return err(r.error[0], origin, r.error[1]);
  const t = r.target!;
  if (t.auth_uid) {
    const { error: banErr } = await supabaseAdmin.auth.admin.updateUserById(t.auth_uid, { ban_duration: activo ? "none" : BAN_FOREVER });
    if (banErr) return err("No se pudo actualizar el acceso del usuario.", origin, 500);
  }
  const { error: upErr } = await supabaseAdmin.from("Usuarios").update({ activo }).eq("id", t.id);
  if (upErr) return err("No se pudo actualizar el perfil.", origin, 500);
  return ok({ id: t.id, activo }, origin, 200);
}

/* ── DELETE USER ─────────────────────────────────────────────────────── */
async function handleDeleteUser(
  body: Record<string, unknown>, callerRole: string, callerOrgId: string | null,
  callerAuthUid: string, supabaseAdmin: SB, origin: string | null
): Promise<Response> {
  const r = await loadAuthorizedTarget(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin);
  if (r.error) return err(r.error[0], origin, r.error[1]);
  const t = r.target!;

  // Primero cortar el acceso (si falla el resto, el usuario ya no entra).
  if (t.auth_uid) {
    await supabaseAdmin.auth.admin.updateUserById(t.auth_uid, { ban_duration: BAN_FOREVER });
    await supabaseAdmin.from("user_roles").delete().eq("user_id", t.auth_uid);
  }
  const { error: delErr } = await supabaseAdmin.from("Usuarios").delete().eq("id", t.id);
  if (delErr) return err(`Error eliminando perfil: ${delErr.message}`, origin, 500);
  if (t.auth_uid) {
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(t.auth_uid);
    if (authDelErr) console.error(`[deleteUser] Auth delete error: ${authDelErr.message}`);
  }
  return ok({ id: t.id }, origin, 200);
}
