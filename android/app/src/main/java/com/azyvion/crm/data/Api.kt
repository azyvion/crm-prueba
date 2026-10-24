package com.azyvion.crm.data

import com.azyvion.crm.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Error con un mensaje para mostrar al usuario. [incierto] = no se sabe si el servidor lo procesó. */
class ApiException(message: String, val status: Int = 0, val incierto: Boolean = false, val datos: JsonObject? = null) : Exception(message)

/**
 * Cliente de Supabase: Edge Functions, PostgREST (tablas y RPC) y renovación del token.
 * Todas las reglas (licencia, permisos, totales del POS) las aplica el servidor.
 */
class Api(private val sesiones: SessionStore, private val alExpirar: () -> Unit) {
    private val url = BuildConfig.SUPABASE_URL
    private val anon = BuildConfig.SUPABASE_ANON_KEY
    private val tipoJson = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS)
        .build()
    private val renovando = Mutex()

    // ── Edge Functions públicas (login / registro) ──
    suspend fun funcion(nombre: String, cuerpo: JsonObject): Pair<Int, JsonObject> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$url/functions/v1/$nombre")
            .header("apikey", anon).header("Authorization", "Bearer $anon")
            .post(cuerpo.toString().toRequestBody(tipoJson)).build()
        try {
            http.newCall(req).execute().use { r -> r.code to parse(r.body?.string().orEmpty()).asObj() }
        } catch (e: IOException) {
            throw ApiException("Sin conexión. Revisa tu internet e intenta de nuevo.", incierto = true)
        }
    }

    // ── Token ──
    private suspend fun tokenVigente(forzar: Boolean = false): String {
        val s = sesiones.actual.value ?: throw ApiException("Tu sesión terminó. Inicia sesión de nuevo.", 401)
        val ahora = System.currentTimeMillis() / 1000
        if (!forzar && s.expiraEn - ahora > 60) return s.accessToken
        return renovando.withLock {
            val actual = sesiones.actual.value ?: throw ApiException("Tu sesión terminó.", 401)
            if (!forzar && actual.expiraEn - System.currentTimeMillis() / 1000 > 60) return@withLock actual.accessToken
            val cuerpo = buildJsonObject { put("refresh_token", actual.refreshToken) }
            val req = Request.Builder().url("$url/auth/v1/token?grant_type=refresh_token")
                .header("apikey", anon).post(cuerpo.toString().toRequestBody(tipoJson)).build()
            val (code, json) = withContext(Dispatchers.IO) {
                try { http.newCall(req).execute().use { r -> r.code to parse(r.body?.string().orEmpty()).asObj() } }
                catch (e: IOException) { throw ApiException("Sin conexión. Revisa tu internet.", incierto = true) }
            }
            val access = json.str("access_token")
            if (code !in 200..299 || access == null) {
                alExpirar()
                throw ApiException("Tu sesión terminó. Inicia sesión de nuevo.", 401)
            }
            val expira = json.num("expires_at")?.toLong() ?: (System.currentTimeMillis() / 1000 + (json.num("expires_in")?.toLong() ?: 3600))
            sesiones.actualizarTokens(access, json.str("refresh_token") ?: actual.refreshToken, expira)
            access
        }
    }

    private suspend fun ejecutar(construir: (String) -> Request): JsonElement {
        var token = tokenVigente()
        repeat(2) { intento ->
            val req = construir(token)
            val (code, texto) = withContext(Dispatchers.IO) {
                try { http.newCall(req).execute().use { r -> r.code to r.body?.string().orEmpty() } }
                catch (e: IOException) {
                    throw ApiException("Sin conexión con el servidor. Revisa tu internet.", incierto = req.method != "GET")
                }
            }
            if (code == 401 && intento == 0) { token = tokenVigente(forzar = true); return@repeat }
            if (code in 200..299) return parse(texto)
            val err = runCatching { parse(texto).asObj() }.getOrNull()
            val msg = err?.str("message") ?: err?.str("error") ?: err?.str("msg")
            throw ApiException(traducir(msg, code), code, datos = err)
        }
        throw ApiException("Tu sesión terminó. Inicia sesión de nuevo.", 401)
    }

    private fun traducir(msg: String?, code: Int): String = when {
        msg.isNullOrBlank() -> "Error del servidor ($code). Intenta de nuevo."
        msg.contains("row-level security", true) || code == 403 -> "No tienes permiso para esta acción o tu empresa no tiene una licencia vigente."
        msg.contains("JWT", true) -> "Tu sesión terminó. Inicia sesión de nuevo."
        else -> msg
    }

    private fun base(token: String) = Request.Builder().header("apikey", anon).header("Authorization", "Bearer $token")

    /** GET /rest/v1/{tabla}?{filtros}. Ej.: select("Clientes", "select" to "*", "order" to "nombre") */
    suspend fun select(tabla: String, vararg params: Pair<String, String>): List<JsonObject> {
        val u = "$url/rest/v1/$tabla".toHttpUrl().newBuilder().apply { params.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return ejecutar { t -> base(t).url(u).get().build() }.objects()
    }

    suspend fun insert(tabla: String, fila: JsonObject): JsonObject? {
        val r = ejecutar { t ->
            base(t).url("$url/rest/v1/$tabla").header("Prefer", "return=representation")
                .post(fila.toString().toRequestBody(tipoJson)).build()
        }
        return r.firstObj()
    }

    /** PATCH con filtros (p. ej. "id" to "eq.<uuid>"). Devuelve las filas afectadas. */
    suspend fun update(tabla: String, cambios: JsonObject, vararg filtros: Pair<String, String>): List<JsonObject> {
        val u = "$url/rest/v1/$tabla".toHttpUrl().newBuilder().apply { filtros.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        return ejecutar { t ->
            base(t).url(u).header("Prefer", "return=representation").patch(cambios.toString().toRequestBody(tipoJson)).build()
        }.objects()
    }

    suspend fun delete(tabla: String, vararg filtros: Pair<String, String>) {
        val u = "$url/rest/v1/$tabla".toHttpUrl().newBuilder().apply { filtros.forEach { (k, v) -> addQueryParameter(k, v) } }.build()
        ejecutar { t -> base(t).url(u).delete().build() }
    }

    /** POST /rest/v1/rpc/{fn}. */
    suspend fun rpc(fn: String, args: JsonObject = JsonObject(emptyMap())): JsonElement =
        ejecutar { t -> base(t).url("$url/rest/v1/rpc/$fn").post(args.toString().toRequestBody(tipoJson)).build() }

    /** RPC que devuelve {ok:false,error} en vez de lanzar: lo convierte en excepción. */
    suspend fun rpcOk(fn: String, args: JsonObject = JsonObject(emptyMap())): JsonObject {
        val r = rpc(fn, args).asObj()
        if (r.bool("ok") == false) throw ApiException(r.str("error") ?: "No se pudo completar la operación.", datos = r)
        return r
    }
}
