# Azyvion Enterprise — Especificación de diseño

Fecha: 2026-10-23 UTC · Alcance: CRM (`dashboard.html` y sus módulos) + páginas públicas (login, registro, encuesta, Freelancer). La landing (`index.html`) queda fuera por decisión del propietario.

## Arquitectura
| Archivo | Rol |
|---|---|
| `azyvion-theme.js` | Motor de tema. Se carga síncrono en `<head>` (sin parpadeo). Preferencia `claro / oscuro / sistema` en `localStorage['azyvion_theme']`; si no existe, usa `Usuarios.tema` cacheado; si tampoco, `sistema`. Resultado: `<html data-theme="light|dark">` + clase heredada `theme-dark` en `<html>` y `<body>`. Cambio en vivo; redibuja las gráficas del resumen; escucha cambios del sistema operativo. API: `AzTheme.get() / mode() / set(pref) / syncFromServer(tema) / mount(el)`. |
| `azyvion-enterprise.css` | Capa final del sistema de diseño (se carga al final del `<head>`). Tokens, mapeo de tokens heredados y componentes. Todos los selectores van prefijados con `html[data-theme]` para ganar a las reglas heredadas con `!important`. |

Sin dependencias nuevas, sin cambio de framework. `dashboard.css` no se modificó.

## Tokens (claro → oscuro)
| Token | Claro | Oscuro |
|---|---|---|
| `--az-bg` | `#F5F7FA` | `#0D1522` |
| `--az-surface` / `-2` / `-hover` | `#FFFFFF` / `#F8FAFC` / `#F1F5F9` | `#131F30` / `#172538` / `#1B2A3D` |
| `--az-text` / `-2` / `-3` | `#172B4D` / `#5B6B80` / `#7C8A9C` | `#E8EEF6` / `#A6B4C7` / `#8394AA` |
| `--az-border` / `-strong` | `#E2E8F0` / `#CBD5E1` | `#2B3B50` / `#3A4D66` |
| `--az-primary` (+hover, soft, on-primary) | `#1F5F99` (`#12345A`) | `#8FC7F0` (`#B5DBF6`), texto sobre primario `#0D1522` |
| `--az-focus` | `#63B3E5` | `#63B3E5` |
| éxito / advertencia / error / info | `#16845B` / `#9A6416` / `#C0392B` / `#2875B8` | `#53C79A` / `#E7B65C` / `#F07878` / `#8FC7F0` |
| `--az-sidebar` | `#12345A → #0E2A4A` | `#0F1A29 → #0B1420` |
| gráficas `--az-chart-1..5`, `--az-chart-grid` | azul, celeste, verde, ámbar, magenta | versiones claras |

Ajustes de contraste respecto al brief: texto secundario `#64748B → #5B6B80` y advertencia como texto `#B7791F → #9A6416`, para cumplir AA (≥4.5:1) sobre los fondos claros. Magenta de marca (logo) solo en gráficas.

Los tokens heredados (`--bg`, `--card`, `--text-primary`, `--accent`, `--success`, `--sidebar`, `--bank-*`, etc.) se reasignan a los nuevos, así los 15 módulos heredan el diseño sin tocar su JS.

## Componentes normalizados
Barra lateral (agrupada por secciones existentes, indicador celeste del activo, logo oficial sobre placa blanca **sin filtros**), encabezado (título, búsqueda global existente, selector de tema, acción principal), encabezado móvil azul marino con selector compacto de un botón (cicla claro → oscuro → sistema), tarjetas/KPIs con cifras tabulares, tablas (cabecera sobria, hover, números alineados, modo compacto), pestañas de filtro, paginación, insignias de estado, campos con foco visible, botones primario / secundario / destructivo / deshabilitado, modales, toasts, aviso de prueba, navegación inferior móvil, estado vacío (`.az-empty`) y esqueleto de carga (`.az-skeleton`), foco de teclado, `prefers-reduced-motion`, impresión.

Tema oscuro: corrección de los colores fijos más comunes en plantillas JS (`background:#fff`, `color:#111/#000`…). El ticket térmico se mantiene blanco (se imprime).

## Decisiones
1. Logo y wordmark oficiales sin alterar: la versión anterior invertía el wordmark con `filter`; ahora va sobre placa blanca.
2. "Sistema" se guarda solo en el navegador; `Usuarios.tema` sigue aceptando `claro/oscuro`. El switch de Perfil sigue funcionando y su elección se aplica como preferencia explícita.
3. Páginas públicas: paleta Azyvion en modo claro únicamente (son formularios para clientes/candidatos con muchos colores fijos; un modo oscuro allí requeriría reescribirlas).
4. Las cifras de marketing del login no se tocaron (pendiente de revisión de contenido).

## Limitaciones conocidas
- Quedan colores fijos en plantillas JS (≈439 en total) que no siguen el tema oscuro en todos los casos; se corrigieron los patrones más comunes. Revisar módulo por módulo con sesión real.
- Los acentos de color heredados (bordes superiores de tarjetas del resumen, botón POS morado en móvil) siguen visibles.
- QA visual hecho en un arnés local sin backend: las pantallas con datos reales no se vieron.
