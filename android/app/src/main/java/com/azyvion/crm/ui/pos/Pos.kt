package com.azyvion.crm.ui.pos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.azyvion.crm.data.ApiException
import com.azyvion.crm.data.Cliente
import com.azyvion.crm.data.CuentaBancaria
import com.azyvion.crm.data.Empresa
import com.azyvion.crm.data.MiLicencia
import com.azyvion.crm.data.Producto
import com.azyvion.crm.data.Repo
import com.azyvion.crm.data.arr
import com.azyvion.crm.data.n
import com.azyvion.crm.data.s
import com.azyvion.crm.domain.Calc
import com.azyvion.crm.ui.common.BotonPrincipal
import com.azyvion.crm.ui.common.Buscador
import com.azyvion.crm.ui.common.Campo
import com.azyvion.crm.ui.common.Contenido
import com.azyvion.crm.ui.common.Tarjeta
import com.azyvion.crm.ui.common.Vacio
import com.azyvion.crm.ui.common.abrirWhatsApp
import com.azyvion.crm.ui.common.app
import com.azyvion.crm.ui.common.compartirTexto
import com.azyvion.crm.ui.common.fechaCorta
import com.azyvion.crm.ui.common.rememberCarga
import com.azyvion.crm.ui.common.toast
import com.azyvion.crm.ui.cotizaciones.ElegirDialog
import com.azyvion.crm.ui.inventario.buscarPorCodigo
import com.azyvion.crm.ui.inventario.cantidadTexto
import com.azyvion.crm.ui.scanner.EscanerDialog
import com.azyvion.crm.ui.theme.Rojo
import com.azyvion.crm.ui.theme.Verde
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

private data class DatosPos(
    val productos: List<Producto>, val clientes: List<Cliente>, val cuentas: List<CuentaBancaria>,
    val permisos: Repo.PosPermisos, val empresa: Empresa, val caja: Repo.EstadoCaja,
)

private data class ItemCarrito(val producto: Producto, val cantidad: Double, val precio: Double)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PosScreen(nav: NavController, lic: MiLicencia?) {
    val a = app()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val c = rememberCarga {
        DatosPos(
            a.repo.productos().also { a.cache.productos = it }, a.repo.clientesPos(), a.repo.cuentasBancarias(),
            a.repo.posPermisos(), a.cache.empresa ?: a.repo.empresa().also { a.cache.empresa = it }, a.repo.estadoCaja(),
        )
    }
    val carrito = remember { mutableStateListOf<ItemCarrito>() }
    var cliente by remember { mutableStateOf<Cliente?>(null) }
    var descuento by remember { mutableStateOf("") }
    var q by remember { mutableStateOf("") }
    var escanear by remember { mutableStateOf(false) }
    var elegirCliente by remember { mutableStateOf(false) }
    var cobrar by remember { mutableStateOf(false) }
    var ticket by remember { mutableStateOf<JsonObject?>(null) }
    var menu by remember { mutableStateOf(false) }
    var dialogoCaja by remember { mutableStateOf<String?>(null) }   // abrir | mov | cerrar
    // Una clave de idempotencia por carrito: si cambia el carrito, se genera otra.
    var clave by remember { mutableStateOf(Calc.nuevaClave()) }
    fun carritoCambio() { clave = Calc.nuevaClave() }

    Scaffold(topBar = {
        TopAppBar(title = {
            Column {
                Text("Vender", fontWeight = FontWeight.Bold)
                c.datos?.caja?.let { k -> Text(if (k.abierta) "Caja abierta · ${k.cajero}" else "Caja cerrada", fontSize = 12.sp, color = if (k.abierta) Verde else MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        }, actions = {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Opciones") }
            DropdownMenu(menu, { menu = false }) {
                val d = c.datos
                if (d != null && !d.caja.abierta) DropdownMenuItem(text = { Text("Abrir caja") }, onClick = { menu = false; dialogoCaja = "abrir" })
                if (d != null && d.caja.abierta && d.permisos.cajaMov) DropdownMenuItem(text = { Text("Entrada / salida de efectivo") }, onClick = { menu = false; dialogoCaja = "mov" })
                if (d != null && d.caja.abierta) DropdownMenuItem(text = { Text("Cerrar caja") }, onClick = { menu = false; dialogoCaja = "cerrar" })
                DropdownMenuItem(text = { Text("Recargar productos") }, onClick = { menu = false; c.recargar() })
            }
        })
    }) { pad ->
        Contenido(c) { d ->
            val lista = cliente?.listaPrecio?.takeIf { it in listOf("Publico", "Plata", "Oro") } ?: "Publico"
            val descPct = (descuento.toDoubleOrNull() ?: 0.0).coerceIn(0.0, 100.0)
            val tot = Calc.totalesPos(carrito.map { Calc.Linea(it.cantidad, it.precio) }, descPct, d.empresa.ivaPct, if (d.empresa.ivaModalidad == "sobre") "sobre" else "incluido")
            val requiereCaja = when (d.permisos.cajaObligatoria) { "si" -> true; "no" -> false; else -> !lic?.plan.equals("Starter", true) }

            fun agregar(p: Producto) {
                val precio = Calc.precioSegunLista(p.precioPublico, p.precioPlata, p.precioOro, lista)
                val i = carrito.indexOfFirst { it.producto.id == p.id }
                val nueva = (if (i >= 0) carrito[i].cantidad else 0.0) + 1
                if (!p.esServicio && !d.permisos.puedeVenderSinStock && nueva > p.unidades) { toast(ctx, "Existencia insuficiente de ${p.nombre} (disponible: ${cantidadTexto(p.unidades)})."); return }
                if (i >= 0) carrito[i] = carrito[i].copy(cantidad = nueva) else carrito.add(ItemCarrito(p, 1.0, precio))
                carritoCambio()
            }

            Column(Modifier.padding(pad).fillMaxSize()) {
                if (requiereCaja && !d.caja.abierta) {
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth()) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Abre la caja para poder cobrar.", Modifier.weight(1f))
                            TextButton(onClick = { dialogoCaja = "abrir" }) { Text("Abrir caja") }
                        }
                    }
                }
                Buscador(q, { q = it }, "Buscar o escanear producto", extra = { IconButton(onClick = { escanear = true }) { Icon(Icons.Default.QrCodeScanner, "Escanear") } })
                val t = q.trim().lowercase()
                if (t.isNotEmpty()) {
                    val res = d.productos.filter { it.activo && listOf(it.nombre, it.sku, it.codigoBarras).any { v -> v.lowercase().contains(t) } }.take(30)
                    LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp)) {
                        if (res.isEmpty()) item { Vacio("Sin productos para «$q».") }
                        items(res, key = { it.id }) { p ->
                            Row(Modifier.fillMaxWidth().clickable { agregar(p); q = "" }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(p.nombre, fontWeight = FontWeight.SemiBold)
                                    Text((if (p.esServicio) "Servicio" else "Existencia ${cantidadTexto(p.unidades)}") + if (p.sku.isNotBlank()) " · ${p.sku}" else "",
                                        fontSize = 12.sp, color = if (!p.esServicio && p.unidades <= 0) Rojo else MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                Text(Calc.q(Calc.precioSegunLista(p.precioPublico, p.precioPlata, p.precioOro, lista)), fontWeight = FontWeight.SemiBold)
                            }
                            HorizontalDivider()
                        }
                    }
                } else {
                    LazyColumn(Modifier.weight(1f), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        item {
                            Tarjeta(onClick = { elegirCliente = true }) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Default.Person, null); Spacer(Modifier.width(10.dp))
                                    Column(Modifier.weight(1f)) {
                                        Text(cliente?.nombre ?: "Consumidor Final (C/F)", fontWeight = FontWeight.SemiBold)
                                        Text("NIT ${cliente?.nit?.ifBlank { null } ?: "C/F"} · precio $lista", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    if (cliente != null) IconButton(onClick = { cliente = null; recalcularPrecios(carrito, "Publico"); carritoCambio() }) { Icon(Icons.Default.Close, "Quitar cliente") }
                                }
                            }
                        }
                        if (carrito.isEmpty()) item { Vacio("Busca o escanea productos para agregarlos a la venta.") }
                        items(carrito.size) { i ->
                            val it = carrito[i]
                            Tarjeta {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(it.producto.nombre, fontWeight = FontWeight.SemiBold)
                                        Text("${Calc.q(it.precio)} c/u", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    IconButton(onClick = {
                                        if (it.cantidad <= 1) carrito.removeAt(i) else carrito[i] = it.copy(cantidad = it.cantidad - 1)
                                        carritoCambio()
                                    }) { Icon(Icons.Default.Remove, "Menos") }
                                    Text(cantidadTexto(it.cantidad), fontWeight = FontWeight.Bold)
                                    IconButton(onClick = { agregar(it.producto) }) { Icon(Icons.Default.Add, "Más") }
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                    Text(Calc.q(Calc.r2(it.cantidad * it.precio)), fontWeight = FontWeight.SemiBold)
                                }
                            }
                        }
                        if (carrito.isNotEmpty() && d.permisos.descuento) item {
                            Campo("Descuento % (máx. ${cantidadTexto(d.permisos.descuentoMax)})", descuento, { v -> descuento = v; carritoCambio() }, teclado = KeyboardType.Decimal)
                        }
                    }
                }
                // Total y cobro
                Surface(tonalElevation = 3.dp, shadowElevation = 6.dp) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        if (tot.descuento > 0) Text("Descuento: -${Calc.q(tot.descuento)}", fontSize = 13.sp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("Total", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(Calc.q(tot.total), fontSize = 26.sp, fontWeight = FontWeight.Bold)
                                Text("IVA ${Calc.q(tot.iva)} · ${carrito.sumOf { it.cantidad }.let { cantidadTexto(it) }} artículos", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            BotonPrincipal("Cobrar", {
                                when {
                                    descPct > d.permisos.descuentoMax -> toast(ctx, "Su descuento máximo autorizado es ${cantidadTexto(d.permisos.descuentoMax)}%.")
                                    requiereCaja && !d.caja.abierta -> dialogoCaja = "abrir"
                                    else -> cobrar = true
                                }
                            }, Modifier.width(150.dp), habilitado = carrito.isNotEmpty() && tot.total > 0)
                        }
                    }
                }
            }

            if (escanear) EscanerDialog(alLeer = { codigo ->
                escanear = false
                val p = buscarPorCodigo(d.productos.filter { it.activo }, codigo)
                if (p != null) { agregar(p); toast(ctx, "${p.nombre} agregado") } else { q = codigo; toast(ctx, "No hay un producto con el código $codigo") }
            }, alCerrar = { escanear = false })

            if (elegirCliente) ElegirDialog("Cliente de la venta", d.clientes, { "${it.nombre} ${it.nit} ${it.telefono}" }, { it.nombre },
                { "NIT ${it.nit.ifBlank { "C/F" }} · ${it.listaPrecio}" }, alCerrar = { elegirCliente = false }) { cl ->
                cliente = cl; elegirCliente = false
                recalcularPrecios(carrito, cl.listaPrecio); carritoCambio()
            }

            if (cobrar) CobroDialog(
                total = tot.total, permisos = d.permisos, cuentas = d.cuentas,
                alCerrar = { cobrar = false },
                alCobrar = { pagos ->
                    val items = carrito.map { Repo.ItemVenta(it.producto.id, it.cantidad, it.precio) }
                    try {
                        val (tk, dup) = a.repo.registrarVenta(clave, items, tot.descPct, tot.total, lista, cliente, pagos, !requiereCaja)
                        if (dup) toast(ctx, "Esta venta ya estaba registrada; no se cobró dos veces.")
                        tk
                    } catch (e: ApiException) {
                        // Si se cortó la red no sabemos si se registró: se consulta con la misma clave.
                        if (e.incierto) a.repo.ventaPorClave(clave) ?: throw ApiException("No se pudo confirmar la venta por la conexión. Intenta cobrar de nuevo: no se cobrará dos veces.")
                        else throw e
                    }
                },
                alTerminar = { tk ->
                    cobrar = false; ticket = tk
                    carrito.clear(); cliente = null; descuento = ""; carritoCambio()
                    c.recargar()   // existencias y caja actualizadas
                },
            )

            dialogoCaja?.let { tipo ->
                CajaDialog(tipo, d.caja, alCerrar = { dialogoCaja = null }, alHecho = { msg -> dialogoCaja = null; toast(ctx, msg); c.recargar() })
            }
        }
    }

    ticket?.let { tk ->
        val emp = a.cache.empresa
        AlertDialog(onDismissRequest = { ticket = null }, title = { Text("Venta ${tk.s("numero")}") }, text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(textoTicket(tk, emp), fontSize = 13.sp)
            }
        }, confirmButton = { TextButton(onClick = { ticket = null }) { Text("Nueva venta") } }, dismissButton = {
            Row {
                TextButton(onClick = { compartirTexto(ctx, textoTicket(tk, emp), "Compartir comprobante") }) { Text("Compartir") }
                val tel = a.cache.clientes.find { it.id == tk.s("clienteId") }?.telefono.orEmpty()
                if (tel.isNotBlank()) TextButton(onClick = { abrirWhatsApp(ctx, tel, textoTicket(tk, emp)) }) { Text("WhatsApp") }
            }
        })
    }
}

/** Al cambiar de cliente, los precios siguen su lista (Público / Plata / Oro), igual que la web y el servidor. */
private fun recalcularPrecios(carrito: MutableList<ItemCarrito>, lista: String) {
    for (i in carrito.indices) {
        val p = carrito[i].producto
        carrito[i] = carrito[i].copy(precio = Calc.precioSegunLista(p.precioPublico, p.precioPlata, p.precioOro, lista))
    }
}

/** Comprobante en texto (interno, no es factura FEL). */
fun textoTicket(t: JsonObject, emp: Empresa?): String = buildString {
    emp?.nombre?.takeIf { it.isNotBlank() }?.let { appendLine(it) }
    appendLine("Comprobante ${t.s("numero")} · ${fechaCorta(t.s("fecha"))}")
    appendLine("Cliente: ${t.s("cliente")} · NIT ${t.s("nit")}")
    appendLine()
    t.arr("items").forEach { appendLine("${cantidadTexto(it.n("cantidad"))} × ${it.s("descripcion")}  ${Calc.q(it.n("total"))}") }
    appendLine()
    appendLine("Subtotal: ${Calc.q(t.n("subtotal"))}")
    if (t.n("descuento") > 0) appendLine("Descuento: -${Calc.q(t.n("descuento"))}")
    appendLine("IVA incluido: ${Calc.q(t.n("iva"))}")
    appendLine("TOTAL: ${Calc.q(t.n("total"))}")
    t.arr("pagos").forEach { appendLine("${it.s("metodo")}: ${Calc.q(it.n("recibido").takeIf { r -> r > 0 } ?: it.n("monto"))}") }
    if (t.n("cambio") > 0) appendLine("Cambio: ${Calc.q(t.n("cambio"))}")
    appendLine()
    append("Comprobante interno — no es factura electrónica.")
}

private data class PagoEd(val metodo: String, val monto: String, val referencia: String, val cuenta: String?)

@Composable
private fun CobroDialog(
    total: Double, permisos: Repo.PosPermisos, cuentas: List<CuentaBancaria>,
    alCerrar: () -> Unit, alCobrar: suspend (List<Calc.Pago>) -> JsonObject, alTerminar: (JsonObject) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val pagos = remember { mutableStateListOf(PagoEd("Efectivo", Calc.r2(total).toString(), "", null)) }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val lista = pagos.map { Calc.Pago(it.metodo, it.monto.replace(",", ".").toDoubleOrNull(), it.referencia, it.cuenta) }
    val v = Calc.validarPagos(total, lista, permisos.redondeo, permisos.metodos)

    AlertDialog(onDismissRequest = { if (!ocupado) alCerrar() }, title = { Text("Cobrar ${Calc.q(total)}") }, text = {
        Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState())) {
            pagos.forEachIndexed { i, p ->
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    permisos.metodos.forEach { m -> FilterChip(p.metodo == m, { pagos[i] = p.copy(metodo = m) }, label = { Text(m, fontSize = 12.sp) }) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Campo(if (p.metodo == "Efectivo") "Efectivo recibido" else "Monto", p.monto, { pagos[i] = p.copy(monto = it) }, Modifier.weight(1f), teclado = KeyboardType.Decimal)
                    if (pagos.size > 1) IconButton(onClick = { pagos.removeAt(i) }) { Icon(Icons.Default.Close, "Quitar pago") }
                }
                if (p.metodo != "Efectivo") Campo("Referencia (autorización o boleta)", p.referencia, { pagos[i] = p.copy(referencia = it) })
                if (p.metodo == "Transferencia" && cuentas.isNotEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        cuentas.take(3).forEach { k -> FilterChip(p.cuenta == k.id, { pagos[i] = p.copy(cuenta = k.id) }, label = { Text(k.nombre.ifBlank { k.banco }, fontSize = 11.sp) }) }
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 6.dp))
            }
            if (pagos.first().metodo == "Efectivo" && pagos.size == 1) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf(50.0, 100.0, 200.0).filter { it > total }.take(3).forEach { b ->
                        OutlinedButton(onClick = { pagos[0] = pagos[0].copy(monto = cantidadTexto(b)) }) { Text("Q ${cantidadTexto(b)}") }
                    }
                }
            }
            TextButton(onClick = { pagos.add(PagoEd(permisos.metodos.firstOrNull { it != "Efectivo" } ?: "Efectivo", "", "", null)) }) { Text("+ Otro método (pago mixto)") }
            Spacer(Modifier.height(4.dp))
            if (v.ok) { if (v.cambio > 0) Text("Cambio: ${Calc.q(v.cambio)}", fontWeight = FontWeight.Bold, fontSize = 18.sp, color = Verde) }
            else Text(v.error, color = Rojo, fontSize = 13.sp)
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 6.dp)) }
        }
    }, confirmButton = {
        TextButton(enabled = v.ok && !ocupado, onClick = {
            ocupado = true; error = null
            scope.launch {
                try { alTerminar(alCobrar(lista)) } catch (e: Exception) { error = e.message }
                ocupado = false
            }
        }) { Text(if (ocupado) "Cobrando…" else "Confirmar cobro") }
    }, dismissButton = { TextButton(enabled = !ocupado, onClick = alCerrar) { Text("Cancelar") } })
}

@Composable
private fun CajaDialog(tipo: String, caja: Repo.EstadoCaja, alCerrar: () -> Unit, alHecho: (String) -> Unit) {
    val a = app()
    val scope = rememberCoroutineScope()
    var monto by remember { mutableStateOf("") }
    var texto by remember { mutableStateOf("") }
    var mov by remember { mutableStateOf("Entrada") }
    var ocupado by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val esperado = caja.resumen?.n("esperado")
    AlertDialog(onDismissRequest = { if (!ocupado) alCerrar() }, title = {
        Text(when (tipo) { "abrir" -> "Abrir caja"; "mov" -> "Movimiento de efectivo"; else -> "Cerrar caja" })
    }, text = {
        Column {
            when (tipo) {
                "abrir" -> Text("Efectivo con el que inicia el turno.", fontSize = 14.sp)
                "mov" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Entrada", "Salida").forEach { m -> FilterChip(mov == m, { mov = m }, label = { Text(m) }) }
                }
                else -> {
                    caja.resumen?.let { r ->
                        Text("Ventas en efectivo: ${Calc.q(r.n("ventasEfectivo"))}", fontSize = 13.sp)
                        Text("Tarjeta: ${Calc.q(r.n("ventasTarjeta"))} · Transferencia: ${Calc.q(r.n("ventasTransferencia"))}", fontSize = 13.sp)
                        Text("Efectivo esperado en caja: ${Calc.q(esperado ?: 0.0)}", fontWeight = FontWeight.Bold)
                    }
                }
            }
            Campo(if (tipo == "cerrar") "Efectivo contado" else "Monto (Q)", monto, { monto = it }, teclado = KeyboardType.Decimal)
            Campo(if (tipo == "mov") "Motivo *" else "Observaciones", texto, { texto = it })
            if (tipo == "cerrar") monto.replace(",", ".").toDoubleOrNull()?.let { contado ->
                val dif = Calc.r2(contado - (esperado ?: 0.0))
                Text("Diferencia: ${Calc.q(dif)}", color = if (dif == 0.0) Verde else Rojo, fontWeight = FontWeight.SemiBold)
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }, confirmButton = {
        TextButton(enabled = !ocupado, onClick = {
            val m = monto.replace(",", ".").toDoubleOrNull()
            if (m == null || m < 0) { error = "Ingresa un monto válido."; return@TextButton }
            ocupado = true; error = null
            scope.launch {
                try {
                    when (tipo) {
                        "abrir" -> { a.repo.abrirCaja(m, texto); alHecho("Caja abierta") }
                        "mov" -> { a.repo.movimientoCaja(mov, m, texto); alHecho("Movimiento registrado") }
                        else -> {
                            val r = a.repo.cerrarCaja(caja.cajaId, m, texto)
                            alHecho("Caja cerrada · diferencia ${Calc.q(r.n("diferencia"))}")
                        }
                    }
                } catch (e: Exception) { error = e.message }
                ocupado = false
            }
        }) { Text("Confirmar") }
    }, dismissButton = { TextButton(enabled = !ocupado, onClick = alCerrar) { Text("Cancelar") } })
}

