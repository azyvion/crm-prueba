package com.azyvion.crm.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Datos de la sesión iniciada (lo que devuelve login-crm). */
data class Sesion(
    val accessToken: String,
    val refreshToken: String,
    val expiraEn: Long,             // epoch en segundos
    val nombre: String,
    val usuario: String,
    val rol: String,
    val orgId: String,
    val submenus: List<String>,     // permisos.submenus; vacío = sin restricción
) {
    val rolUp get() = rol.uppercase()
    val esPrivilegiado get() = rolUp == "ADMIN" || rolUp == "GERENTE" || rolUp == "SUPER_ADMIN"
    val esVendedor get() = rolUp == "VENDEDOR"
    /** ¿Puede ver el módulo? Admin/gerente: todo. El resto: según sus permisos (la RLS igual protege). */
    fun puede(modulo: String): Boolean = when {
        esPrivilegiado -> true
        esVendedor && modulo in setOf("prospectos", "inventario") -> false
        submenus.isEmpty() -> true
        else -> modulo in submenus
    }
}

/** Sesión guardada cifrada (Android Keystore). */
class SessionStore(context: Context) {
    private val prefs: SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "azyvion_sesion", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        // Si el almacén cifrado se corrompe (p. ej. tras restaurar el teléfono) se empieza de cero.
        context.deleteSharedPreferences("azyvion_sesion")
        context.getSharedPreferences("azyvion_sesion_fallback", Context.MODE_PRIVATE).also { it.edit().clear().apply() }
    }

    private val _actual = MutableStateFlow(leer())
    val actual: StateFlow<Sesion?> = _actual

    private fun leer(): Sesion? {
        val t = prefs.getString("token", null) ?: return null
        return Sesion(
            accessToken = t,
            refreshToken = prefs.getString("refresh", "").orEmpty(),
            expiraEn = prefs.getLong("expira", 0),
            nombre = prefs.getString("nombre", "").orEmpty(),
            usuario = prefs.getString("usuario", "").orEmpty(),
            rol = prefs.getString("rol", "").orEmpty(),
            orgId = prefs.getString("org", "").orEmpty(),
            submenus = prefs.getString("submenus", "").orEmpty().split(',').filter { it.isNotBlank() },
        )
    }

    fun guardar(s: Sesion) {
        prefs.edit()
            .putString("token", s.accessToken).putString("refresh", s.refreshToken).putLong("expira", s.expiraEn)
            .putString("nombre", s.nombre).putString("usuario", s.usuario).putString("rol", s.rol)
            .putString("org", s.orgId).putString("submenus", s.submenus.joinToString(","))
            .apply()
        _actual.value = s
    }

    fun actualizarTokens(access: String, refresh: String, expira: Long) {
        val s = _actual.value ?: return
        guardar(s.copy(accessToken = access, refreshToken = refresh, expiraEn = expira))
    }

    fun cerrar() {
        prefs.edit().clear().apply()
        _actual.value = null
    }

    var ultimoUsuario: String
        get() = prefs.getString("ultimo_usuario", "").orEmpty()
        set(v) { prefs.edit().putString("ultimo_usuario", v).apply() }
}
