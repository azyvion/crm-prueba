package com.azyvion.crm.ui.inventario

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Producto
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.ui.common.Buscador
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Dato
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Vacio
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.scanner.EscanerDialog
import com.azyvion.crm.ui.theme.Ambar
import com.azyvion.crm.ui.theme.Rojo
import com.azyvion.crm.ui.theme.Verde

/** Busca un producto por código de barras, SKU o nombre exacto (para el escáner). */
fun buscarPorCodigo(lista: List<Producto>, codigo: String): Producto? {
    val c = codigo.trim()
    if (c.isEmpty()) return null
    return lista.firstOrNull { it.codigoBarras.equals(c, true) } ?: lista.firstOrNull { it.sku.equals(c, true) }
        ?: lista.firstOrNull { it.nombre.equals(c, true) }
}

fun estadoStock(p: Producto): Pair<String, androidx.compose.ui.graphics.Color>? = when {
    p.esServicio -> null
    p.unidades <= 0 -> "Agotado" to Rojo
    p.unidades <= (if (p.stockMinimo > 0) p.stockMinimo else 5.0) -> "Bajo" to Ambar
    else -> "Disponible" to Verde
}

fun cantidadTexto(v: Double) = if (v % 1.0 == 0.0) v.toLong().toString() else v.toString()

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventarioScreen(nav: NavController) {
    val a = app()
    val ctx = LocalContext.current
    val c = rememberCarga { a.repo.productos().also { a.cache.productos = it } }
    var q by rememberSaveable { mutableStateOf("") }
    var filtro by rememberSaveable { mutableStateOf("Todos") }
    var escanear by remember { mutableStateOf(false) }
    var detalle by remember { mutableStateOf<Producto?>(null) }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Inventario") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } },
            actions = { IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") } })
    }) { pad ->
        Column(Modifier.padding(pad)) {
            Buscador(q, { q = it }, "Nombre, SKU o código", extra = { IconButton(onClick = { escanear = true }) { Icon(Icons.Default.QrCodeScanner, "Escanear") } })
            LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("Todos", "Bajo o agotado", "Productos", "Servicios")) { f -> FilterChip(filtro == f, { filtro = f }, label = { Text(f) }) }
            }
            Contenido(c) { lista ->
                val t = q.trim().lowercase()
                val filtrados = lista.filter { p ->
                    p.activo && when (filtro) {
                        "Bajo o agotado" -> estadoStock(p)?.first.let { it == "Bajo" || it == "Agotado" }
                        "Productos" -> !p.esServicio
                        "Servicios" -> p.esServicio
                        else -> true
                    } && (t.isEmpty() || listOf(p.nombre, p.sku, p.codigoBarras, p.categoria).any { it.lowercase().contains(t) })
                }
                LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { Text("${filtrados.size} ítems", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp)) }
                    if (filtrados.isEmpty()) item { Vacio("Sin productos con este filtro.") }
                    items(filtrados, key = { it.id }) { p ->
                        Tarjeta(onClick = { detalle = p }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(p.nombre, fontWeight = FontWeight.SemiBold)
                                    Text(listOf(p.sku, p.categoria).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(Calc.q(p.precioPublico), fontWeight = FontWeight.SemiBold)
                                    estadoStock(p)?.let { (txt, col) -> Etiqueta(if (txt == "Disponible") "${cantidadTexto(p.unidades)} ${p.unidad.lowercase()}" else "$txt · ${cantidadTexto(p.unidades)}", col) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if (escanear) EscanerDialog(alLeer = { codigo ->
        escanear = false
        val p = buscarPorCodigo(c.datos ?: emptyList(), codigo)
        if (p != null) detalle = p else { q = codigo; toast(ctx, "No hay un producto con el código $codigo") }
    }, alCerrar = { escanear = false })
    detalle?.let { p ->
        AlertDialog(onDismissRequest = { detalle = null }, title = { Text(p.nombre) }, text = {
            Column {
                Dato("SKU", p.sku); Dato("Código", p.codigoBarras); Dato("Categoría", p.categoria); Dato("Tipo", p.tipo)
                if (!p.esServicio) Dato("Existencia", "${cantidadTexto(p.unidades)} ${p.unidad.lowercase()}")
                Dato("Precio público", Calc.q(p.precioPublico))
                if (p.precioPlata > 0) Dato("Precio Plata", Calc.q(p.precioPlata))
                if (p.precioOro > 0) Dato("Precio Oro", Calc.q(p.precioOro))
                Dato("Descripción", p.descripcion)
            }
        }, confirmButton = { TextButton(onClick = { detalle = null }) { Text("Cerrar") } })
    }
}
