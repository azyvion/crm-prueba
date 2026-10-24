package com.azyvion.crm.ui.cotizaciones

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.Cliente
import com.azyvion.crm.data.Cotizacion
import com.azyvion.crm.data.CotItem
import com.azyvion.crm.data.Empresa
import com.azyvion.crm.data.Producto
import com.azyvion.crm.data.Repo
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.ui.common.BotonPrincipal
import com.azyvion.crm.ui.common.Buscador
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Etiqueta
import com.azyvion.crm.ui.common.PaddingLista
import com.azyvion.crm.ui.common.Selector
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Titulo
import com.azyvion.crm.ui.common.Vacio
import com.azyvion.crm.ui.common.abrirWhatsApp
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.colorEstadoCot
import com.azyvion.crm.ui.common.compartirTexto
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.inventario.cantidadTexto
import kotlinx.coroutines.launch

private val ESTADOS = listOf("Borrador", "Enviada", "Aprobada", "Rechazada", "Vencida")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CotizacionesScreen(nav: NavController) {
    val a = app()
    val c = rememberCarga { a.repo.cotizaciones() }
    var filtro by rememberSaveable { mutableStateOf("Todas") }
    var q by rememberSaveable { mutableStateOf("") }
    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Cotizaciones") },
                navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } },
                actions = { IconButton(onClick = { c.recargar() }) { Icon(Icons.Default.Refresh, "Actualizar") } })
        },
        floatingActionButton = { ExtendedFloatingActionButton(onClick = { nav.navigate("cotizacionNueva") }, icon = { Icon(Icons.Default.Add, null) }, text = { Text("Cotización") }) },
    ) { pad ->
        Column(Modifier.padding(pad)) {
            Buscador(q, { q = it }, "Número o cliente")
            LazyRow(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("Todas") + ESTADOS) { f -> FilterChip(filtro == f, { filtro = f }, label = { Text(f) }) }
            }
            Contenido(c) { lista ->
                val t = q.trim().lowercase()
                val filtradas = lista.filter { (filtro == "Todas" || it.estado == filtro) && (t.isEmpty() || it.numero.lowercase().contains(t) || it.cliente.lowercase().contains(t)) }
                LazyColumn(contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { Text("${filtradas.size} cotizaciones · ${Calc.qEntero(filtradas.sumOf { it.total })}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp)) }
                    if (filtradas.isEmpty()) item { Vacio("Sin cotizaciones.") }
                    items(filtradas, key = { it.id }) { x ->
                        Tarjeta(onClick = { nav.navigate("cotizacion/${x.id}") }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(x.numero, fontWeight = FontWeight.SemiBold)
                                    Text("${x.cliente} · ${fechaCorta(x.fecha)}", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                                }
                                Column(horizontalAlignment = Alignment.End) { Etiqueta(x.estado, colorEstadoCot(x.estado)); Text(Calc.q(x.total), fontWeight = FontWeight.SemiBold) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Texto de la cotización para enviar por WhatsApp o compartir. */
fun textoCotizacion(c: Cotizacion, items: List<CotItem>, emp: Empresa?): String = buildString {
    appendLine("*${emp?.nombre?.ifBlank { null } ?: "Cotización"}*")
    appendLine("Cotización ${c.numero} · ${fechaCorta(c.fecha)}")
    appendLine("Cliente: ${c.cliente}")
    appendLine()
    items.forEach { appendLine("• ${cantidadTexto(it.cantidad)} × ${it.descripcion} — ${Calc.q(it.total)}") }
    appendLine()
    if (c.descuento > 0) appendLine("Descuento: -${Calc.q(c.descuento)}")
    if (c.iva > 0) appendLine("IVA: ${Calc.q(c.iva)}")
    appendLine("*Total: ${Calc.q(c.total)}*")
    appendLine("Válida por ${c.validezDias} días.")
    if (c.condiciones.isNotBlank()) appendLine(c.condiciones)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CotizacionDetalleScreen(nav: NavController, id: String) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = rememberCarga(id) { a.repo.cotizacion(id) }
    val emp = rememberCarga { a.cache.empresa ?: a.repo.empresa().also { a.cache.empresa = it } }
    Scaffold(topBar = {
        TopAppBar(title = { Text(c.datos?.first?.numero ?: "Cotización") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } },
            actions = {
                c.datos?.let { (cot, items) ->
                    IconButton(onClick = { compartirTexto(ctx, textoCotizacion(cot, items, emp.datos), "Compartir cotización") }) { Icon(Icons.Default.Share, "Compartir") }
                }
            })
    }) { pad ->
        Contenido(c) { (cot, lineasCot) ->
            LazyColumn(Modifier.padding(pad), contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    Tarjeta {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(cot.cliente, fontWeight = FontWeight.Bold); Text(fechaCorta(cot.fecha) + " · válida ${cot.validezDias} días", fontSize = 13.sp) }
                            Etiqueta(cot.estado, colorEstadoCot(cot.estado))
                        }
                    }
                }
                item {
                    Tarjeta {
                        Titulo("Ítems")
                        lineasCot.forEach { i ->
                            Row(Modifier.padding(top = 8.dp)) {
                                Column(Modifier.weight(1f)) {
                                    Text(i.descripcion)
                                    Text("${cantidadTexto(i.cantidad)} × ${Calc.q(i.precioUnit)}" + if (i.descuentoPct > 0) " · -${cantidadTexto(i.descuentoPct)}%" else "", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(Calc.q(i.total), fontWeight = FontWeight.SemiBold)
                            }
                        }
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        Linea("Subtotal", Calc.q(cot.subtotal))
                        if (cot.descuento > 0) Linea("Descuento (${cantidadTexto(cot.descuentoPct)}%)", "-" + Calc.q(cot.descuento))
                        if (cot.iva > 0) Linea("IVA", Calc.q(cot.iva))
                        Linea("Total", Calc.q(cot.total), true)
                    }
                }
                item {
                    Titulo("Cambiar estado")
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(ESTADOS) { e ->
                            FilterChip(cot.estado == e, {
                                scope.launch { try { a.repo.cambiarEstadoCotizacion(cot.id, e); c.recargar() } catch (ex: Exception) { toast(ctx, ex.message ?: "Error") } }
                            }, label = { Text(e) })
                        }
                    }
                }
                item {
                    OutlinedButton(onClick = {
                        abrirWhatsApp(ctx, cot.telefono, textoCotizacion(cot, lineasCot, emp.datos))
                        if (cot.estado == "Borrador") scope.launch { runCatching { a.repo.cambiarEstadoCotizacion(cot.id, "Enviada") }; c.recargar() }
                    }, modifier = Modifier.fillMaxWidth()) { Text("Enviar por WhatsApp") }
                }
            }
        }
    }
}

@Composable
private fun Linea(t: String, v: String, fuerte: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(t, Modifier.weight(1f), fontWeight = if (fuerte) FontWeight.Bold else FontWeight.Normal)
        Text(v, fontWeight = if (fuerte) FontWeight.Bold else FontWeight.Normal, fontSize = if (fuerte) 17.sp else 14.sp)
    }
}

private data class LineaEd(val producto: Producto?, val descripcion: String, val cantidad: String, val precio: String, val desc: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CotizacionNuevaScreen(nav: NavController) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val datos = rememberCarga {
        Triple(
            a.cache.clientes.ifEmpty { a.repo.clientes().also { a.cache.clientes = it } },
            a.cache.productos.ifEmpty { a.repo.productos().also { a.cache.productos = it } },
            a.cache.empresa ?: a.repo.empresa().also { a.cache.empresa = it },
        )
    }
    var cliente by remember { mutableStateOf<Cliente?>(null) }
    var nombreLibre by remember { mutableStateOf("") }
    val lineas = remember { mutableStateListOf<LineaEd>() }
    var descGeneral by remember { mutableStateOf("") }
    var iva by remember { mutableStateOf(true) }
    var notas by remember { mutableStateOf("") }
    var elegirCliente by remember { mutableStateOf(false) }
    var elegirProducto by remember { mutableStateOf(false) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Scaffold(topBar = {
        TopAppBar(title = { Text("Nueva cotización") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Volver") } })
    }) { pad ->
        Contenido(datos) { (clientes, productos, emp) ->
            val totales = lineas.map { Calc.totalLinea(it.cantidad.toDoubleOrNull() ?: 0.0, it.precio.toDoubleOrNull() ?: 0.0, it.desc.toDoubleOrNull() ?: 0.0) }
            val t = Calc.totalesCotizacion(totales, descGeneral.toDoubleOrNull() ?: 0.0, iva, emp.ivaPct, emp.ivaModalidad)
            LazyColumn(Modifier.padding(pad).imePadding(), contentPadding = PaddingLista, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Tarjeta(onClick = { elegirCliente = true }) {
                        Text("Cliente", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(cliente?.nombre ?: nombreLibre.ifBlank { "Toca para elegir un cliente" }, fontWeight = FontWeight.SemiBold)
                    }
                }
                item { Titulo("Ítems") }
                lineas.forEachIndexed { i, l ->
                    item(key = "l$i") {
                        Tarjeta {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Campo("Descripción", l.descripcion, { lineas[i] = l.copy(descripcion = it) }, Modifier.weight(1f))
                                IconButton(onClick = { lineas.removeAt(i) }) { Icon(Icons.Default.Delete, "Quitar") }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Campo("Cant.", l.cantidad, { lineas[i] = l.copy(cantidad = it) }, Modifier.weight(1f), teclado = KeyboardType.Decimal)
                                Campo("Precio", l.precio, { lineas[i] = l.copy(precio = it) }, Modifier.weight(1.4f), teclado = KeyboardType.Decimal)
                                Campo("Desc %", l.desc, { lineas[i] = l.copy(desc = it) }, Modifier.weight(1f), teclado = KeyboardType.Decimal)
                            }
                            Text("Total línea: ${Calc.q(totales.getOrElse(i) { 0.0 })}", fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { elegirProducto = true }, modifier = Modifier.weight(1f)) { Text("+ Del inventario") }
                        OutlinedButton(onClick = { lineas.add(LineaEd(null, "", "1", "", "")) }, modifier = Modifier.weight(1f)) { Text("+ Línea libre") }
                    }
                }
                item {
                    Tarjeta {
                        Campo("Descuento general %", descGeneral, { descGeneral = it }, teclado = KeyboardType.Decimal)
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { iva = !iva }) {
                            Checkbox(iva, { iva = it }); Text("Aplica IVA (${cantidadTexto(emp.ivaPct)}% ${if (emp.ivaModalidad == "sobre") "sobre el precio" else "incluido"})")
                        }
                        Campo("Notas", notas, { notas = it }, lineas = 2)
                        HorizontalDivider(Modifier.padding(vertical = 8.dp))
                        Linea("Subtotal", Calc.q(t.subtotal))
                        if (t.descuento > 0) Linea("Descuento", "-" + Calc.q(t.descuento))
                        if (t.iva > 0) Linea("IVA", Calc.q(t.iva))
                        Linea("Total", Calc.q(t.total), true)
                    }
                }
                error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
                item {
                    BotonPrincipal("Crear cotización", {
                        ocupado = true; error = null
                        scope.launch {
                            try {
                                val num = a.repo.crearCotizacion(cliente, cliente?.nombre ?: nombreLibre,
                                    lineas.map { Repo.LineaCot(it.producto?.id, it.producto?.tipo ?: "Producto", it.descripcion, it.cantidad.toDoubleOrNull() ?: 0.0, it.precio.toDoubleOrNull() ?: 0.0, it.desc.toDoubleOrNull() ?: 0.0) },
                                    descGeneral.toDoubleOrNull() ?: 0.0, iva, notas, emp)
                                toast(ctx, "Cotización $num creada")
                                nav.popBackStack()
                            } catch (e: Exception) { error = e.message }
                            ocupado = false
                        }
                    }, ocupado = ocupado)
                }
            }
            if (elegirCliente) ElegirDialog("Elegir cliente", clientes, { "${it.nombre} ${it.nit} ${it.telefono}" }, { it.nombre }, { it.empresa }, alCerrar = { elegirCliente = false },
                libre = { nombreLibre = it; cliente = null; elegirCliente = false }) { cliente = it; elegirCliente = false }
            if (elegirProducto) ElegirDialog("Agregar del inventario", productos.filter { it.activo }, { "${it.nombre} ${it.sku} ${it.codigoBarras}" }, { it.nombre },
                { Calc.q(Calc.precioSegunLista(it.precioPublico, it.precioPlata, it.precioOro, cliente?.listaPrecio ?: "Publico")) }, alCerrar = { elegirProducto = false }) { p ->
                val precio = Calc.precioSegunLista(p.precioPublico, p.precioPlata, p.precioOro, cliente?.listaPrecio ?: "Publico")
                lineas.add(LineaEd(p, p.nombre, "1", cantidadTexto(precio), "")); elegirProducto = false
            }
        }
    }
}

/** Diálogo de búsqueda y selección reutilizable. [libre] permite escribir un nombre que no está en la lista. */
@Composable
fun <T> ElegirDialog(titulo: String, lista: List<T>, texto: (T) -> String, principal: (T) -> String, secundario: (T) -> String,
                     alCerrar: () -> Unit, libre: ((String) -> Unit)? = null, alElegir: (T) -> Unit) {
    var q by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = alCerrar, title = { Text(titulo) }, text = {
        Column {
            Buscador(q, { q = it }, "Buscar", modifier = Modifier.padding(0.dp))
            val t = q.trim().lowercase()
            val filtrados = lista.filter { t.isEmpty() || texto(it).lowercase().contains(t) }.take(80)
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                if (libre != null && q.isNotBlank()) item { TextButton(onClick = { libre(q.trim()) }) { Text("Usar «${q.trim()}» sin registrar") } }
                if (filtrados.isEmpty()) item { Text("Sin resultados.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(8.dp)) }
                items(filtrados) { x ->
                    Column(Modifier.fillMaxWidth().clickable { alElegir(x) }.padding(vertical = 10.dp)) {
                        Text(principal(x), fontWeight = FontWeight.SemiBold)
                        val s = secundario(x); if (s.isNotBlank()) Text(s, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider()
                }
            }
        }
    }, confirmButton = { TextButton(onClick = alCerrar) { Text("Cerrar") } })
}

