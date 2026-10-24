package com.azyvion.crm.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * Lectura tolerante del JSON de Supabase: las columnas antiguas a veces guardan números
 * como texto o booleanos como "true"; aquí todo se convierte sin lanzar excepciones.
 */
val JSON = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false }

fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content
fun JsonObject.s(k: String): String = str(k).orEmpty()
fun JsonObject.num(k: String): Double? {
    val p = this[k] as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    return p.doubleOrNull ?: p.content.trim().replace(",", "").toDoubleOrNull()
}
fun JsonObject.n(k: String): Double = num(k) ?: 0.0
fun JsonObject.bool(k: String): Boolean? {
    val p = this[k] as? JsonPrimitive ?: return null
    if (p is JsonNull) return null
    return p.booleanOrNull ?: when (p.content.trim().lowercase()) { "true", "t", "1", "si", "sí" -> true; "false", "f", "0", "no" -> false; else -> null }
}
fun JsonObject.obj(k: String): JsonObject? = this[k] as? JsonObject
fun JsonObject.arr(k: String): List<JsonObject> = (this[k] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

fun JsonElement?.objects(): List<JsonObject> = (this as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()
fun JsonElement?.asObj(): JsonObject = (this as? JsonObject) ?: JsonObject(emptyMap())
fun parse(texto: String): JsonElement = if (texto.isBlank()) JsonNull else JSON.parseToJsonElement(texto)
fun JsonElement.firstObj(): JsonObject? = (this as? JsonArray)?.firstOrNull()?.jsonObject ?: (this as? JsonObject)
@Suppress("unused") fun JsonElement.lista(): List<JsonElement> = (this as? JsonArray)?.jsonArray ?: emptyList()
