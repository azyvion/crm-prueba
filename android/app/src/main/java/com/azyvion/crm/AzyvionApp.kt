package com.azyvion.crm

import android.app.Application
import com.azyvion.crm.data.Api
import com.azyvion.crm.data.Cliente
import com.azyvion.crm.data.Empresa
import com.azyvion.crm.data.Producto
import com.azyvion.crm.data.Prospecto
import com.azyvion.crm.data.Repo
import com.azyvion.crm.data.SessionStore

/** Contenedor de dependencias de la app (sin frameworks de inyección). */
class AzyvionApp : Application() {
    lateinit var sesiones: SessionStore; private set
    lateinit var repo: Repo; private set

    /** Últimos datos cargados, para abrir fichas y formularios sin volver a descargar. */
    val cache = Cache()

    override fun onCreate() {
        super.onCreate()
        sesiones = SessionStore(this)
        val api = Api(sesiones) { sesiones.cerrar() }
        repo = Repo(api, sesiones)
    }
}

class Cache {
    @Volatile var clientes: List<Cliente> = emptyList()
    @Volatile var prospectos: List<Prospecto> = emptyList()
    @Volatile var productos: List<Producto> = emptyList()
    @Volatile var empresa: Empresa? = null
    fun limpiar() { clientes = emptyList(); prospectos = emptyList(); productos = emptyList(); empresa = null }
}
