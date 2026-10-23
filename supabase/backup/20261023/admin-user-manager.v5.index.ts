// RESPALDO — admin-user-manager v5 tal como estaba desplegada el 2026-10-23 (verify_jwt: true)
// ⚠️ Contiene las vulnerabilidades SEC-02/SEC-03. Usar solo para revertir en emergencia.
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
  if (userError || !callerAuthUser) return err(`Token inválido: ${userError?.message}`, origin, 401);
  const callerAuthUid = callerAuthUser.id;
  console.log(`[admin-user-manager] caller uid: ${callerAuthUid}`);

  const { data: isSuperAdmin, error: saErr } = await supabaseUser.rpc("is_super_admin");
  if (saErr) return err(`Error is_super_admin: ${saErr.message}`, origin, 500);
  console.log(`[admin-user-manager] isSuperAdmin: ${isSuperAdmin}`);

  let callerRole: string;
  let callerOrgId: string | null = null;

  if (isSuperAdmin === true) {
    callerRole = "SUPER_ADMIN";
  } else {
    const { data: orgId, error: orgErr } = await supabaseUser.rpc("get_my_org_id");
    if (orgErr || !orgId) return err(`Error get_my_org_id: ${orgErr?.message}`, origin, 500);
    callerOrgId = String(orgId);
    const { data: role, error: roleErr } = await supabaseUser.rpc("get_my_role", { p_org_id: callerOrgId });
    if (roleErr || !role) return err(`Error get_my_role: ${roleErr?.message}`, origin, 500);
    callerRole = String(role);
  }
  console.log(`[admin-user-manager] callerRole: ${callerRole}, callerOrgId: ${callerOrgId}`);

  if (!ALLOWED_CALLER_ROLES.includes(callerRole)) return err(`Rol no autorizado: ${callerRole}`, origin, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return err("Payload JSON inválido.", origin, 400); }
  console.log(`[admin-user-manager] action: ${body.action}, rol: ${body.rol}, org: ${body.organization_id}`);

  let action: string;
  try { action = sanitizeValue(body.action); }
  catch { return err("Payload contiene contenido no permitido.", origin, 400); }

  switch (action) {
    case "createUser":        return await handleCreateUser(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "resetUserPassword": return await handleResetPassword(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "updateUserEmail":   return await handleUpdateEmail(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    case "deleteUser":        return await handleDeleteUser(body, callerRole, callerOrgId, callerAuthUid, supabaseAdmin, origin);
    default: return err(`Acción desconocida: ${action}`, origin, 400);
  }
});

/* ── CREATE USER ─────────────────────────────────────────────────────── */
async function handleCreateUser(
  body: Record<string, unknown>,
  callerRole: string,
  callerOrgId: string | null,
  callerAuthUid: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  origin: string | null
): Promise<Response> {
  let email: string, password: string, usuario: string, nombre: string;
  let rolLegacy: string, correo: string, telefono: string, cargo: string;

  try {
    email     = sanitizeValue(body.email);
    usuario   = sanitizeValue(body.usuario);
    nombre    = sanitizeValue(body.nombre);
    rolLegacy = sanitizeValue(body.rol);
    correo    = sanitizeValue(body.correo ?? body.email);
    telefono  = sanitizeValue(body.telefono ?? "");
    cargo     = sanitizeValue(body.cargo ?? "");
    password  = typeof body.password === "string" ? body.password : "";
  } catch (e) {
    return err(`Sanitize error: ${e}`, origin, 400);
  }

  console.log(`[createUser] email=${email} usuario=${usuario} rol=${rolLegacy}`);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return err("Email inválido.", origin, 400);
  if (!password || password.length < 6)
    return err("Contraseña mínimo 6 caracteres.", origin, 400);
  if (!usuario) return err("Campo usuario obligatorio.", origin, 400);
  if (!nombre)  return err("Campo nombre obligatorio.", origin, 400);

  if (!Object.prototype.hasOwnProperty.call(ROLE_MAP, rolLegacy))
    return err(`Rol inválido: '${rolLegacy}'. Aceptados: ${Object.keys(ROLE_MAP).join(", ")}.`, origin, 400);

  const rolInterno = ROLE_MAP[rolLegacy];
  console.log(`[createUser] rolInterno=${rolInterno}`);

  if (callerRole === "ADMIN" && !ADMIN_CREATABLE_ROLES.includes(rolInterno))
    return err(`ADMIN no puede crear rol ${rolInterno}.`, origin, 403);
  if (callerRole === "SUPER_ADMIN" && !SUPER_ADMIN_CREATABLE_ROLES.includes(rolInterno))
    return err(`SUPER_ADMIN no puede crear rol ${rolInterno}.`, origin, 403);

  let targetOrgId: string;
  if (callerRole === "ADMIN") {
    if (!callerOrgId) return err("ADMIN sin organización.", origin, 500);
    targetOrgId = callerOrgId;
  } else {
    let requestedOrg: string;
    try { requestedOrg = sanitizeValue(body.organization_id); }
    catch { return err("organization_id inválido.", origin, 400); }

    if (!requestedOrg) return err("SUPER_ADMIN debe indicar organization_id.", origin, 400);
    console.log(`[createUser] SUPER_ADMIN targetOrg=${requestedOrg}`);

    const { data: orgExists, error: orgCheckErr } = await supabaseAdmin
      .from("sub_empresas").select("id").eq("id", requestedOrg).maybeSingle();
    console.log(`[createUser] orgExists=${JSON.stringify(orgExists)} orgErr=${orgCheckErr?.message}`);
    if (orgCheckErr || !orgExists) return err(`Organización no encontrada: ${requestedOrg}`, origin, 404);
    targetOrgId = requestedOrg;
  }
  console.log(`[createUser] targetOrgId=${targetOrgId}`);

  const { data: existingUsuario, error: existingErr } = await supabaseAdmin
    .from("Usuarios").select("id").eq("usuario", usuario).maybeSingle();
  if (existingErr) return err(`Error verificando usuario: ${existingErr.message}`, origin, 500);
  if (existingUsuario) return err("Ya existe un usuario con ese nombre.", origin, 409);

  console.log(`[createUser] Creando en Auth...`);
  let newAuthUid: string;

  const { data: existingAuthUsers } = await supabaseAdmin.auth.admin.listUsers();
  const existingAuthUser = existingAuthUsers?.users?.find((u) => u.email === email);

  if (existingAuthUser) {
    console.log(`[createUser] Correo ya existe en Auth, reutilizando uid=${existingAuthUser.id}`);
    newAuthUid = existingAuthUser.id;
    await supabaseAdmin.auth.admin.updateUserById(newAuthUid, { password, email_confirm: true });
  } else {
    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { name: nombre },
    });
    if (authErr || !authData?.user) {
      const msg = authErr?.message || "";
      return err(`Auth error: ${msg}`, origin, 500);
    }
    newAuthUid = authData.user.id;
  }
  console.log(`[createUser] Auth OK, newAuthUid=${newAuthUid}`);

  await supabaseAdmin.from("user_roles").delete().eq("user_id", newAuthUid);

  console.log(`[createUser] Llamando RPC admin_create_usuario_profile...`);
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
  console.log(`[createUser] RPC result: data=${insertData} err=${insertErr?.message}`);

  if (insertErr || !insertData) {
    await supabaseAdmin.auth.admin.deleteUser(newAuthUid);
    return err(`RPC error: ${insertErr?.message || "sin datos"}`, origin, 500);
  }
  const newUsuarioId = String(insertData);

  console.log(`[createUser] Insertando user_roles role=${rolInterno}...`);
  const { error: roleInsertErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: newAuthUid, role: rolInterno, organization_id: targetOrgId });

  if (roleInsertErr) {
    console.error(`[createUser] user_roles error: ${roleInsertErr.message}`);
    await supabaseAdmin.from("Usuarios").delete().eq("id", newUsuarioId);
    await supabaseAdmin.auth.admin.deleteUser(newAuthUid);
    return err(`Error asignando rol: ${roleInsertErr.message}`, origin, 500);
  }

  console.log(`[createUser] ÉXITO id=${newUsuarioId}`);
  return ok({ id: newUsuarioId, auth_uid: newAuthUid, usuario, nombre, rol: rolLegacy, correo: correo || email, organization_id: targetOrgId }, origin, 201);
}

/* ── RESET PASSWORD ──────────────────────────────────────────────────── */
async function handleResetPassword(
  body: Record<string, unknown>,
  callerRole: string,
  callerOrgId: string | null,
  callerAuthUid: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  origin: string | null
): Promise<Response> {
  const password = typeof body.password === "string" ? body.password : "";
  let userId: string;
  try { userId = sanitizeValue(body.user_id); }
  catch { return err("user_id inválido.", origin, 400); }

  if (!userId)   return err("Campo user_id obligatorio.", origin, 400);
  if (!password || password.length < 6) return err("Contraseña mínimo 6 caracteres.", origin, 400);

  const { data: targetUser, error: findErr } = await supabaseAdmin
    .from("Usuarios").select("id, auth_uid, organization_id, rol").eq("id", userId).maybeSingle();
  if (findErr || !targetUser) return err("Usuario no encontrado.", origin, 404);
  if (!targetUser.auth_uid) return err("Usuario sin auth_uid vinculado.", origin, 409);

  const targetAuthUid = String(targetUser.auth_uid);
  const targetOrgId   = targetUser.organization_id ? String(targetUser.organization_id) : null;
  if (!targetOrgId) return err("Usuario sin organización.", origin, 409);
  if (targetAuthUid === callerAuthUid) return err("No puedes resetear tu propia contraseña aquí.", origin, 403);

  const { data: targetRoleRow, error: targetRoleErr } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", targetAuthUid).eq("organization_id", targetOrgId).maybeSingle();
  if (targetRoleErr || !targetRoleRow) return err("No se pudo determinar el rol del usuario objetivo.", origin, 500);

  const targetRole = String(targetRoleRow.role);
  if (callerRole === "ADMIN") {
    if (["SUPER_ADMIN", "ADMIN"].includes(targetRole))
      return err("ADMIN no puede resetear contraseña de ADMIN/SUPER_ADMIN.", origin, 403);
    if (targetOrgId !== callerOrgId)
      return err("No puedes operar sobre usuarios de otra organización.", origin, 403);
  }

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(targetAuthUid, { password });
  if (updateErr) return err(`Error actualizando contraseña: ${updateErr.message}`, origin, 500);
  return ok({ user_id: userId }, origin, 200);
}

/* ── UPDATE EMAIL ────────────────────────────────────────────────────── */
async function handleUpdateEmail(
  body: Record<string, unknown>,
  callerRole: string,
  callerOrgId: string | null,
  callerAuthUid: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  origin: string | null
): Promise<Response> {
  let userId: string, email: string;
  try {
    userId = sanitizeValue(body.user_id);
    email  = sanitizeValue(body.email);
  } catch { return err("Payload inválido.", origin, 400); }

  if (!userId) return err("Campo user_id obligatorio.", origin, 400);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return err("Email inválido.", origin, 400);

  const { data: targetUser, error: findErr } = await supabaseAdmin
    .from("Usuarios").select("auth_uid, organization_id").eq("id", userId).maybeSingle();
  if (findErr || !targetUser) return err("Usuario no encontrado.", origin, 404);
  if (!targetUser.auth_uid) return err("Usuario sin auth_uid vinculado.", origin, 409);

  const targetAuthUid = String(targetUser.auth_uid);
  const targetOrgId   = targetUser.organization_id ? String(targetUser.organization_id) : null;
  if (callerRole === "ADMIN" && targetOrgId !== callerOrgId)
    return err("No puedes operar sobre usuarios de otra organización.", origin, 403);

  const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(targetAuthUid, { email, email_confirm: true });
  if (updateErr) return err(`Error actualizando email: ${updateErr.message}`, origin, 500);
  return ok({ user_id: userId, email }, origin, 200);
}

/* ── DELETE USER ─────────────────────────────────────────────────────── */
async function handleDeleteUser(
  body: Record<string, unknown>,
  callerRole: string,
  callerOrgId: string | null,
  callerAuthUid: string,
  supabaseAdmin: ReturnType<typeof createClient>,
  origin: string | null
): Promise<Response> {
  let userId: string;
  try { userId = sanitizeValue(body.user_id); }
  catch { return err("user_id inválido.", origin, 400); }
  if (!userId) return err("Campo user_id obligatorio.", origin, 400);

  const { data: targetUser, error: findErr } = await supabaseAdmin
    .from("Usuarios").select("id, auth_uid, organization_id, rol").eq("id", userId).maybeSingle();
  if (findErr || !targetUser) return err("Usuario no encontrado.", origin, 404);

  const targetAuthUid = targetUser.auth_uid ? String(targetUser.auth_uid) : null;
  const targetOrgId   = targetUser.organization_id ? String(targetUser.organization_id) : null;

  if (targetAuthUid === callerAuthUid)
    return err("No puedes eliminarte a ti mismo.", origin, 403);

  if (callerRole === "ADMIN") {
    if (["SUPER_ADMIN", "ADMIN"].includes(targetUser.rol))
      return err("ADMIN no puede eliminar ADMIN/SUPER_ADMIN.", origin, 403);
    if (targetOrgId !== callerOrgId)
      return err("No puedes eliminar usuarios de otra organización.", origin, 403);
  }

  if (targetAuthUid) {
    await supabaseAdmin.from("user_roles").delete().eq("user_id", targetAuthUid);
  }

  const { error: delErr } = await supabaseAdmin.from("Usuarios").delete().eq("id", userId);
  if (delErr) return err(`Error eliminando perfil: ${delErr.message}`, origin, 500);

  if (targetAuthUid) {
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(targetAuthUid);
    if (authDelErr) console.error(`[deleteUser] Auth delete error: ${authDelErr.message}`);
  }

  console.log(`[deleteUser] ÉXITO id=${userId}`);
  return ok({ id: userId }, origin, 200);
}
