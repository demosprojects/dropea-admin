let perfilActual = null;      // fila de usuarios (id, usuario, rol)
let emprendedorActual = null; // fila de emprendedores
let productoEditandoId = null; // null = creando, uuid = editando
// URL de la miniatura del producto que se está creando/editando ahora mismo
// en el formulario (columna imagen_thumb_url). Viaja aparte del hidden
// input #imagen (que solo tiene la imagen completa) porque agregar un
// input nuevo al HTML no hacía falta: alcanza con este estado en memoria,
// que se resetea junto con el resto del formulario en cada apertura/cierre.
let imagenThumbUrlActual = '';
let variantesEnEdicion = [];   // [{id?, nombre, valor, precio_adicional, _borrar?}]
let variantesEliminadas = [];  // ids de variantes existentes que se quitaron y hay que borrar en Supabase al guardar
let mediosPagoPerfilSeleccion = [];   // ids seleccionados en "Mi Perfil"
let mediosPagoProductoSeleccion = []; // ids seleccionados en el modal de producto
let productosCache = [];      // último listado de productos traído de Supabase
const inicioCargado = { perfil: false, productos: false, categorias: false }; // el Inicio se pinta recién cuando están los tres

// URL del Worker de Cloudflare que maneja las suscripciones con MercadoPago.
// Reemplazar por la URL real una vez hecho el "wrangler deploy".
const WORKER_SUSCRIPCIONES_URL = 'https://dropeapagos.leonelgalazzoaz.workers.dev';

// URL del Web App de Google Apps Script que recibe los reportes de
// "Reportar un problema" (sección Ayuda) y los guarda en un Google
// Sheet. Se obtiene al hacer "Implementar > Nueva implementación > Aplicación
// web" en el editor de Apps Script (ver instructivo aparte). Termina en /exec.
const APPS_SCRIPT_REPORTES_URL = 'https://script.google.com/macros/s/AKfycbxWjomMnVyMglBiLzxBRHwhu-q-KfGeBAzOgBHLzdAmPBydpummLjO6MNmknAY51HyW/exec';

// Filtros activos del buscador de "Mis productos"
let filtroBusquedaProductos = '';
let filtroEstadoProductos = 'todos';     // 'todos' | 'visibles' | 'ocultos'
let filtroCategoriaProductos = '';       // '' = todas

const grid = document.getElementById('grid-productos');
const contadorProductos = document.getElementById('contador-productos');
const formReportarProblema = document.getElementById('form-reportar-problema');
formReportarProblema?.addEventListener('submit', enviarReporteProblema);
const modal = document.getElementById('modal-form');
const form = document.getElementById('form-producto');
const listaVariantes = document.getElementById('lista-variantes');

// Los campos de Instagram/TikTok solo piden el usuario (sin @ ni link).
// Esta función limpia lo que haya en el campo para quedarnos solo con el
// usuario, ya sea que la persona escriba "usuario", "@usuario" o pegue
// por error un link completo (ej: dato viejo guardado como URL entera).
function extraerUsuarioRedSocial(valor) {
    if (!valor) return '';
    let v = valor.trim();
    v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    v = v.replace(/^(instagram\.com|tiktok\.com)\//i, '');
    v = v.replace(/^@/, '');
    v = v.split(/[?#]/)[0].split('/')[0];
    return v.trim();
}

document.addEventListener('DOMContentLoaded', async () => {
    perfilActual = await requerirSesion('emprendedor');
    if (!perfilActual) return; // requerirSesion ya redirige si no corresponde

    document.getElementById('usuario-sidebar').textContent = '@' + perfilActual.usuario;
    document.getElementById('nombre-tienda-sidebar').textContent = perfilActual.usuario;
    document.getElementById('avatar-sidebar-letra').textContent = perfilActual.usuario.charAt(0).toUpperCase();
    const urlPerfil = urlPerfilPublico();
    const linkQr = document.getElementById('link-ir-a-mi-perfil-qr');
    if (linkQr) linkQr.href = urlPerfil;
    const linkTexto = document.getElementById('share-link-texto');
    if (linkTexto) linkTexto.textContent = urlPerfil.replace(/^https?:\/\//, '');
    const linkHero = document.getElementById('link-ir-a-mi-perfil-hero');
    if (linkHero) linkHero.href = urlPerfil;
    const linkInicio = document.getElementById('link-ir-a-mi-perfil-inicio');
    if (linkInicio) linkInicio.href = urlPerfil;
    const linkInicioTexto = document.getElementById('inicio-link-texto');
    if (linkInicioTexto) linkInicioTexto.textContent = urlPerfil.replace(/^https?:\/\//, '');
    await cargarPerfilEmprendedor();
    verificarTerminos();
    await cargarCategoriasTienda();
    await renderProductos(true);

    iniciarRealtimeDashboard();

    // Avisos individuales del admin (ej. "cargá tu foto de perfil"). Si
    // todavía no aceptó los Términos, ese modal ya está ocupando la
    // pantalla -> esperamos a que entre de nuevo con los términos
    // aceptados para no superponer dos modales.
    if (emprendedorActual && emprendedorActual.terminos_aceptados === true && typeof mostrarAvisosPendientes === 'function') {
        mostrarAvisosPendientes(perfilActual.id);
    }
});


function iniciarRealtimeDashboard() {

    const refrescarProductos = debounce(() => renderProductos(), 350);

    suscribirTabla('productos', refrescarProductos, `emprendedor_id=eq.${perfilActual.id}`);
    suscribirTabla('categorias_tienda', debounce(() => cargarCategoriasTienda(), 350), `emprendedor_id=eq.${perfilActual.id}`);

    // Si el admin bloquea/activa la tienda mientras el emprendedor está en el
    // panel, el banner se actualiza al toque, sin necesidad de recargar.
    suscribirTabla('emprendedores', async (payload) => {
        let fila = payload && payload.new && payload.new.id ? payload.new : null;
        // Sin payload (resincronización pasiva) -> se vuelve a leer la fila.
        if (!fila) {
            const { data, error } = await supabase.from('emprendedores').select('*').eq('id', perfilActual.id).maybeSingle();
            if (error || !data) return;
            fila = data;
        }
        emprendedorActual = fila;
        renderInicio();
        actualizarBannerBloqueo(emprendedorActual);
        renderEstadoSuscripcion(emprendedorActual);
        evaluarAccesoYAvisar(emprendedorActual);
    }, `id=eq.${perfilActual.id}`);

    // Además del chequeo en tiempo real (que depende de que algo cambie
    // en la fila), revisamos el vencimiento cada 5 minutos por si el
    // panel queda abierto en una pestaña y el plazo se cumple mientras
    // tanto (sin que nadie lo edite desde el admin).
    setInterval(() => evaluarAccesoYAvisar(emprendedorActual), 5 * 60 * 1000);

    // Si el admin le manda un aviso individual mientras está en el panel,
    // se lo mostramos al toque sin esperar a que recargue.
    // (solo si existe el módulo de avisos; en estos archivos no está)
    if (typeof mostrarAvisosPendientes === 'function') {
        suscribirTabla('avisos_admin', (payload) => {
            if (payload?.eventType === 'INSERT' && payload.new && !payload.new.leido) {
                mostrarAvisosPendientes(perfilActual.id);
            }
        }, `emprendedor_id=eq.${perfilActual.id}`);
    }
}

// ============================================================
// AVISO DE SUSCRIPCIÓN VENCIDA / CUENTA BLOQUEADA
// ============================================================
// El bloqueo real pasa por otro lado: cuando la suscripción vence, la
// cuenta se marca como inactiva y la tienda deja de mostrarse en la
// comunidad (eso ya lo refleja el banner #banner-tienda-bloqueada, que
// sigue funcionando igual que antes). Este modal es sólo un aviso: se
// muestra una vez al ingresar para que el emprendedor se entere de que
// tiene que pagar de nuevo, pero no le impide seguir usando el panel.
let avisoVencimientoMostrado = false;

function evaluarAccesoYAvisar(emprendedor) {
    const info = calcularEstadoAcceso(emprendedor);
    if (info.bloqueado && !avisoVencimientoMostrado) {
        mostrarModalVencimiento(info);
        avisoVencimientoMostrado = true;
    }
}

function mostrarModalVencimiento(info) {
    const modal = document.getElementById('modal-vencimiento');
    if (!modal) return;

    const titulo = document.getElementById('modal-vencimiento-titulo');
    const mensaje = document.getElementById('modal-vencimiento-mensaje');
    const btnPagar = document.getElementById('modal-vencimiento-btn-pagar');

    if (info.motivo === 'admin') {
        titulo.textContent = 'Tu tienda está bloqueada';
        mensaje.textContent = info.mensaje;
        // El bloqueo manual del admin no siempre es por falta de pago,
        // así que no mostramos el botón de pagar en ese caso.
        btnPagar.classList.add('hidden');
    } else {
        titulo.textContent = info.enPruebaGratis ? 'Tu mes gratis terminó' : 'Tu suscripción venció';
        mensaje.textContent = info.enPruebaGratis
            ? 'Tu tienda dejó de mostrarse en Dropea. Para reactivarla, activá tu suscripción mensual.'
            : 'Tu tienda dejó de mostrarse en Dropea. Para reactivarla, renová tu suscripción mensual.';
        btnPagar.classList.remove('hidden');
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalVencimiento() {
    const modal = document.getElementById('modal-vencimiento');
    if (!modal) return;
    modal.classList.add('hidden');
    // Sólo liberamos el scroll si no hay otro modal (términos) pidiéndolo.
    const modalTerminos = document.getElementById('modal-terminos');
    if (!modalTerminos || modalTerminos.classList.contains('hidden')) {
        document.body.classList.remove('overflow-hidden');
    }
}

// ============================================================
// TÉRMINOS Y CONDICIONES
// ============================================================
// La fuente de verdad es la columna "terminos_aceptados" en Supabase (así el
// admin puede ver en admin.html quién aceptó y quién rechazó). El localStorage
// es sólo una caché para no mostrar el modal de nuevo en este mismo navegador
// mientras se termina de confirmar el guardado.
function claveTerminosLocalStorage() {
    return `cp_terminos_${perfilActual.id}`;
}

function verificarTerminos() {
    // Ya aceptó según la base de datos -> no mostramos nada.
    if (emprendedorActual && emprendedorActual.terminos_aceptados === true) {
        localStorage.setItem(claveTerminosLocalStorage(), '1');
        return;
    }

    // Todavía no respondió, o rechazó anteriormente -> mostramos el modal para
    // que vuelva a decidir (si rechaza, se le cierra la sesión; sin importar el
    // localStorage: la base manda, por si entra desde otro dispositivo/navegador).
    document.getElementById('modal-terminos').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

// URL del PDF del instructivo compartido por Google Drive.
// Reemplazá FILE_ID por el ID del archivo (lo sacás del link para compartir de Drive:
// https://drive.google.com/file/d/FILE_ID/view -> copiá solo esa parte FILE_ID).
// Asegurate de que el archivo esté compartido como "Cualquier persona con el enlace puede ver".
const INSTRUCTIVO_DRIVE_FILE_ID = '1198gPlSr9h1pZG9mGOf92Oe0C99VOWCV';
const INSTRUCTIVO_DRIVE_URL_VER = `https://drive.google.com/file/d/${INSTRUCTIVO_DRIVE_FILE_ID}/view`;
const INSTRUCTIVO_DRIVE_URL_PREVIEW = `https://drive.google.com/file/d/${INSTRUCTIVO_DRIVE_FILE_ID}/preview`;

function abrirInstructivo() {
    document.getElementById('iframe-instructivo').src = INSTRUCTIVO_DRIVE_URL_PREVIEW;
    document.getElementById('link-instructivo-nueva-pestana').href = INSTRUCTIVO_DRIVE_URL_VER;
    document.getElementById('modal-instructivo').classList.remove('hidden');
    // En iOS Safari, overflow-hidden en el body no siempre bloquea el scroll de fondo
    // (rubber-banding), así que además fijamos la posición del body.
    const scrollY = window.scrollY;
    document.body.dataset.scrollY = scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.classList.add('overflow-hidden');
}

function cerrarInstructivo() {
    document.getElementById('modal-instructivo').classList.add('hidden');
    document.getElementById('iframe-instructivo').src = ''; // corta la carga/reproducción al cerrar
    const scrollY = parseInt(document.body.dataset.scrollY || '0', 10);
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.classList.remove('overflow-hidden');
    window.scrollTo(0, scrollY);
}

async function responderTerminos(acepto) {
    const btnAceptar = document.getElementById('btn-aceptar-terminos');
    const btnRechazar = document.getElementById('btn-rechazar-terminos');
    btnAceptar.disabled = true;
    btnRechazar.disabled = true;

    const { error } = await supabase.from('emprendedores')
        .update({ terminos_aceptados: acepto, terminos_respondido_en: new Date().toISOString() })
        .eq('id', perfilActual.id);

    if (error) {
        btnAceptar.disabled = false;
        btnRechazar.disabled = false;
        mostrarToast('No se pudo guardar tu respuesta. Probá de nuevo.', 'error');
        console.error(error);
        return;
    }

    emprendedorActual.terminos_aceptados = acepto;
    localStorage.setItem(claveTerminosLocalStorage(), '1');

    if (!acepto) {
        // Si rechaza los términos, no puede seguir usando el panel: le avisamos
        // y le cerramos la sesión. La próxima vez que inicie sesión, verificarTerminos()
        // va a volver a mostrarle el modal para que decida.
        mostrarToast('Registramos tu rechazo de los términos. Cerrando sesión...', 'info');
        setTimeout(() => { cerrarSesion(); }, 1800);
        return;
    }

    document.getElementById('modal-terminos').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');

    mostrarToast('Gracias por aceptar los términos.', 'success');
}

// Muestra/oculta el aviso de "tienda bloqueada" según el estado del emprendedor.
function actualizarBannerBloqueo(emprendedor) {
    const banner = document.getElementById('banner-tienda-bloqueada');
    if (!banner) return;

    // Usamos calcularEstadoAcceso() (la misma función que dispara el modal
    // de vencimiento y que usa admin.js) en vez de mirar sólo "activo".
    // "activo" únicamente se pone en false cuando el admin bloquea a mano;
    // cuando lo que pasó es que se venció el mes gratis o la suscripción,
    // "activo" sigue en true y este banner nunca se enteraba.
    const acceso = calcularEstadoAcceso(emprendedor);
    const titulo = document.getElementById('banner-tienda-bloqueada-titulo');
    const motivoEl = document.getElementById('banner-tienda-bloqueada-motivo');

    banner.classList.toggle('hidden', !acceso.bloqueado);
    if (!acceso.bloqueado) return;

    if (acceso.motivo === 'admin') {
        if (titulo) titulo.textContent = 'Tu tienda está bloqueada';
        motivoEl.textContent = emprendedor.motivo_bloqueo || 'Contactate con el equipo de Dropea para más información.';
    } else {
        if (titulo) titulo.textContent = 'Tu tienda no se muestra en Dropea';
        motivoEl.textContent = acceso.enPruebaGratis
            ? 'Terminó tu mes gratis sin activarse la suscripción. Activá el pago para que vuelva a aparecer.'
            : 'Venció tu suscripción sin renovarse. Renovala para que tu tienda vuelva a aparecer.';
    }
}

// Buscador con debounce: no filtra en cada tecla, espera a que la persona pare de escribir.
const onFiltroBusquedaProductos = debounce(() => {
    filtroBusquedaProductos = document.getElementById('filtro-busqueda-productos').value;
    pintarGridProductos();
}, 250);

function onFiltroCambiado() {
    filtroEstadoProductos = document.getElementById('filtro-estado-productos').value;
    filtroCategoriaProductos = document.getElementById('filtro-categoria-productos').value;
    pintarGridProductos();
}

function limpiarFiltrosProductos() {
    filtroBusquedaProductos = '';
    filtroEstadoProductos = 'todos';
    filtroCategoriaProductos = '';
    document.getElementById('filtro-busqueda-productos').value = '';
    document.getElementById('filtro-estado-productos').value = 'todos';
    document.getElementById('filtro-categoria-productos').value = '';
    pintarGridProductos();
}

// Aplica los filtros activos (búsqueda + estado + categoría) sobre el listado completo.
function obtenerProductosFiltrados() {
    const termino = filtroBusquedaProductos.trim().toLowerCase();
    // Filtra por categoría de la tienda: incluye también sus subcategorías.
    const idsCategoria = filtroCategoriaProductos
        ? idsSubarbolCategoriaTienda(parseInt(filtroCategoriaProductos, 10))
        : null;
    return productosCache.filter(p => {
        if (filtroEstadoProductos === 'visibles' && !p.activo) return false;
        if (filtroEstadoProductos === 'ocultos' && p.activo) return false;
        if (idsCategoria && !idsCategoria.has(p.categoria_tienda_id)) return false;
        if (termino && !(p.nombre || '').toLowerCase().includes(termino)) return false;
        return true;
    });
}


// ============================================================
// TRANSFERENCIA BANCARIA / INFORMAR PAGO
// ============================================================

// Copia CBU/alias al portapapeles. Usa la Clipboard API cuando está
// disponible (contexto https) y cae a execCommand como respaldo para
// navegadores o contextos que no la soportan. Da feedback visual en el
// propio botón además del toast, para que quede claro en mobile.
async function copiarTexto(texto, boton) {
    let copiado = false;

    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(texto);
            copiado = true;
        }
    } catch (err) {
        console.error(err);
    }

    if (!copiado) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = texto;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            copiado = true;
        } catch (err) {
            console.error(err);
        }
    }

    if (!copiado) {
        mostrarToast('No se pudo copiar. Copialo manualmente.', 'error');
        return;
    }

    mostrarToast('Copiado al portapapeles', 'success');

    if (boton) {
        const htmlOriginal = boton.innerHTML;
        boton.innerHTML = '¡Copiado!';
        boton.disabled = true;
        setTimeout(() => {
            boton.innerHTML = htmlOriginal;
            boton.disabled = false;
        }, 1500);
    }
}

// Select personalizado de "Tipo de problema" (ver form-reportar-problema).
// Reemplaza al <select> nativo, que en varios navegadores mobile se ve con
// la tipografía y el estilo por defecto del sistema operativo, sin tomar
// nada del diseño de la página. El <input type="hidden" id="reporte-tipo">
// sigue siendo el valor real que lee enviarReporteProblema().
function toggleReporteTipoDropdown(forzarAbierto) {
    const lista = document.getElementById('reporte-tipo-lista');
    const trigger = document.getElementById('reporte-tipo-trigger');
    const flecha = document.getElementById('reporte-tipo-flecha');
    if (!lista || !trigger) return;

    const abrir = typeof forzarAbierto === 'boolean' ? forzarAbierto : lista.classList.contains('hidden');
    lista.classList.toggle('hidden', !abrir);
    trigger.setAttribute('aria-expanded', String(abrir));
    flecha?.classList.toggle('rotate-180', abrir);
}

function seleccionarReporteTipo(valor, textoVisible) {
    const inputOculto = document.getElementById('reporte-tipo');
    const textoEl = document.getElementById('reporte-tipo-texto');
    if (!inputOculto || !textoEl) return;

    inputOculto.value = valor;
    textoEl.textContent = textoVisible;
    textoEl.classList.remove('text-slate-400');
    textoEl.classList.add('text-slate-900');

    document.querySelectorAll('#reporte-tipo-lista li').forEach((li) => {
        const activo = li.dataset.valor === valor;
        li.classList.toggle('bg-yellow-50', activo);
        li.classList.toggle('font-bold', activo);
        li.classList.toggle('text-slate-900', activo);
        li.setAttribute('aria-selected', String(activo));
    });

    toggleReporteTipoDropdown(false);
}

// Cierra el dropdown de "Tipo de problema" si se toca fuera de él (botón o lista).
document.addEventListener('click', (event) => {
    const trigger = document.getElementById('reporte-tipo-trigger');
    const lista = document.getElementById('reporte-tipo-lista');
    if (!trigger || !lista || lista.classList.contains('hidden')) return;
    if (!trigger.contains(event.target) && !lista.contains(event.target)) {
        toggleReporteTipoDropdown(false);
    }
});

// Vuelve el select personalizado de "Tipo de problema" a su estado inicial
// (se usa después de un envío exitoso, junto con form.reset()).
function resetearReporteTipoDropdown() {
    document.getElementById('reporte-tipo').value = '';
    const textoEl = document.getElementById('reporte-tipo-texto');
    if (textoEl) {
        textoEl.textContent = 'Seleccioná una opción';
        textoEl.classList.add('text-slate-400');
        textoEl.classList.remove('text-slate-900');
    }
    document.querySelectorAll('#reporte-tipo-lista li').forEach((li) => {
        li.classList.remove('bg-yellow-50', 'font-bold', 'text-slate-900');
        li.setAttribute('aria-selected', 'false');
    });
    toggleReporteTipoDropdown(false);
}

// Envía el formulario "Reportar un problema" (sección Ayuda) al
// Google Sheet a través del Web App de Apps Script. Se manda con
// mode: 'no-cors' porque Apps Script no agrega los headers de CORS que
// necesitaría el navegador para leer la respuesta; igual la fila se guarda
// en el Sheet del lado del servidor, simplemente no podemos leer si salió
// bien o mal desde acá, por eso mostramos éxito apenas el fetch no explota
// (fetch con no-cors no tira error salvo problema de red real).
async function enviarReporteProblema(event) {
    event.preventDefault();

    if (APPS_SCRIPT_REPORTES_URL.includes('PEGAR_ACA_LA_URL_DEL_WEB_APP')) {
        mostrarToast('Falta configurar la URL de Google Apps Script en dashboard.js.', 'error');
        return;
    }

    const tipo = document.getElementById('reporte-tipo').value;
    const descripcion = document.getElementById('reporte-descripcion').value.trim();
    const contacto = document.getElementById('reporte-contacto').value.trim();

    if (!tipo || !descripcion) {
        mostrarToast('Completá el tipo de problema y la descripción.', 'error');
        return;
    }

    const btn = document.getElementById('reporte-btn-enviar');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando...';

    try {
        await fetch(APPS_SCRIPT_REPORTES_URL, {
            method: 'POST',
            // text/plain evita el preflight de CORS (que Apps Script no
            // responde bien), así el POST llega directo como "simple request".
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            mode: 'no-cors',
            body: JSON.stringify({
                tipo,
                descripcion,
                contacto,
                usuario: perfilActual ? perfilActual.usuario : '',
                emprendedor_id: perfilActual ? perfilActual.id : '',
                fecha: new Date().toISOString(),
            }),
        });

        mostrarToast('¡Reporte enviado! Gracias por avisarnos.', 'success');
        document.getElementById('form-reportar-problema').reset();
        resetearReporteTipoDropdown();
    } catch (err) {
        console.error(err);
        mostrarToast('No se pudo enviar el reporte. Probá de nuevo.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
}

// Abre WhatsApp con un mensaje pre-armado para informar el pago por
// transferencia. Incluye el usuario del emprendedor para identificar
// rápido qué cuenta hay que activar desde el admin al recibir el
// comprobante (que la persona adjunta a mano en el chat de WhatsApp).
function informarPagoWhatsapp() {
    const usuario = perfilActual ? perfilActual.usuario : '';
    const texto = `Hola! Quiero informar el pago de mi suscripción por transferencia.\n\nUsuario: @${usuario}\n\nTe mando el comprobante 👇`;
    const url = `https://wa.me/5493735533008?text=${encodeURIComponent(texto)}`;
    window.open(url, '_blank', 'noopener');
}

const NAV_BASE = "w-full text-left px-5 py-3 rounded-full transition-all duration-150 flex items-center gap-3 group text-[11px] font-black uppercase tracking-widest";
const NAV_ACTIVO = `${NAV_BASE} bg-white text-black shadow-[4px_4px_0_0_#facc15] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#facc15]`;
const NAV_INACTIVO = `${NAV_BASE} text-zinc-400 hover:text-yellow-400 hover:bg-white/5`;

function mostrarSeccion(seccionId) {
    const secciones = {
        inicio: document.getElementById('section-inicio'),
        productos: document.getElementById('section-productos'),
        categorias: document.getElementById('section-categorias'),
        perfil: document.getElementById('section-perfil'),
        soporte: document.getElementById('section-soporte'),
        pagos: document.getElementById('section-pagos'),
        anuncios: document.getElementById('section-anuncios'),
        qr: document.getElementById('section-qr'),
    };
    const navs = {
        inicio: document.getElementById('nav-inicio'),
        productos: document.getElementById('nav-productos'),
        categorias: document.getElementById('nav-categorias'),
        perfil: document.getElementById('nav-perfil'),
        soporte: document.getElementById('nav-soporte'),
        pagos: document.getElementById('nav-pagos'),
        anuncios: document.getElementById('nav-anuncios'),
        qr: document.getElementById('nav-qr'),
    };

    Object.keys(secciones).forEach((id) => {
        const activa = id === seccionId;
        secciones[id].classList.toggle('hidden', !activa);
        navs[id].className = activa ? NAV_ACTIVO : NAV_INACTIVO;
    });

    if (seccionId === 'inicio') renderInicio();
    if (seccionId === 'categorias') renderCategoriasTienda();
    if (seccionId === 'anuncios') actualizarContadorAnuncio();
    // La vista previa del cartel QR se arma recién al entrar a la sección
    // (evita generar el QR/objeto de vista previa si el emprendedor nunca la visita).
    if (seccionId === 'qr') renderFormatoQR(formatoQRActivo);

    // Al cambiar de sección siempre arrancamos scrolleados arriba del todo.
    // Sin esto, el scroll de la ventana quedaba donde estaba en la sección
    // anterior (ej: si te ibas hasta el final de "Mis datos", entrabas a
    // "Mis productos" ya scrolleado al final).
    window.scrollTo(0, 0);
    actualizarBtnScrollTop();
    ajustarTextareasAutogrow();
}

// ------------------------------------------------------------
// TEXTAREAS GRANDES CON AUTO-AJUSTE (bio, anuncio, descripción de producto)
// ------------------------------------------------------------
// Los <textarea data-autogrow> arrancan con un alto cómodo (ver .ta-auto en
// el CSS) y crecen a medida que se escribe, hasta el max-height del CSS;
// pasado ese punto scrollean por dentro.
function autoajustarTextarea(el) {
    // Oculto (sección con .hidden): scrollHeight daría 0, se ajusta al mostrarse
    if (!el || el.offsetParent === null) return;

    // Al achicar el alto un instante para medir, el navegador puede corregir
    // el scroll de la página o del modal: lo guardamos y lo restauramos.
    const cuerpoModal = el.closest('.modal-body');
    const scrollModal = cuerpoModal ? cuerpoModal.scrollTop : 0;
    const scrollVentana = window.scrollY;

    const bordes = el.offsetHeight - el.clientHeight;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + bordes) + 'px';

    if (cuerpoModal) cuerpoModal.scrollTop = scrollModal;
    if (window.scrollY !== scrollVentana) window.scrollTo(0, scrollVentana);
}

function ajustarTextareasAutogrow() {
    document.querySelectorAll('textarea[data-autogrow]').forEach(autoajustarTextarea);
}

document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('textarea[data-autogrow]')) autoajustarTextarea(e.target);
});
window.addEventListener('resize', debounce(ajustarTextareasAutogrow, 150));

// ------------------------------------------------------------
// BOTÓN "VOLVER ARRIBA" — solo en la sección Mis productos
// ------------------------------------------------------------
// Aparece mientras se scrollea (una vez pasados unos 400px) y solo si
// #section-productos está visible; unos instantes después de dejar de
// scrollear se esconde solo, y vuelve a aparecer al scrollear de nuevo.
// En cualquier otra sección queda oculto.
const BTN_SCROLL_TOP_ESPERA_MS = 1500;

function actualizarBtnScrollTop() {
    const btn = document.getElementById('btn-scroll-top');
    if (!btn) return;
    const seccion = document.getElementById('section-productos');
    const enProductos = !!seccion && !seccion.classList.contains('hidden');

    clearTimeout(btn._ocultarTimer);

    if (!(enProductos && window.scrollY > 400)) {
        btn.classList.remove('visible');
        return;
    }

    btn.classList.add('visible');
    const programarOcultado = () => {
        btn._ocultarTimer = setTimeout(() => {
            // Si el dedo/mouse/teclado está justo sobre el botón, no se lo sacamos
            if (btn.matches(':hover') || document.activeElement === btn) {
                programarOcultado();
                return;
            }
            btn.classList.remove('visible');
        }, BTN_SCROLL_TOP_ESPERA_MS);
    };
    programarOcultado();
}

function volverArribaProductos() {
    const reducir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reducir ? 'auto' : 'smooth' });
}

window.addEventListener('scroll', actualizarBtnScrollTop, { passive: true });

async function renderProductos(mostrarSpinner = false) {
    if (mostrarSpinner) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-3 py-24 text-slate-400 font-semibold">
                <svg class="w-6 h-6 animate-spin text-slate-300" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span>Cargando productos...</span>
            </div>`;
    }

    const { data, error } = await supabase
        .from('productos')
        .select('*')
        .eq('emprendedor_id', perfilActual.id)
        .order('created_at', { ascending: false });

    if (error) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-2 py-24 text-red-400 font-semibold">
                <span>Error cargando productos.</span>
            </div>`;
        contadorProductos.textContent = '';
        console.error(error);
        return;
    }

    productosCache = data;
    inicioCargado.productos = true;
    renderInicio();
    pintarGridProductos();
    renderCategoriasTienda();
}

function pintarGridProductos() {
    const btnHeader = document.getElementById('btn-nuevo-producto-header');

    // Sin productos cargados todavía (no es un tema de filtros)
    if (productosCache.length === 0) {
        if (btnHeader) btnHeader.classList.add('hidden');
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-3 py-24 text-center">
                <div class="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">🛍️</div>
                <p class="text-slate-500 font-bold">Todavía no subiste productos.</p>
                <p class="text-slate-400 text-sm">Empezá creando tu primer producto para mostrarlo en Dropea y en tu perfil.</p>
                <button onclick="abrirFormulario()" class="mt-2 inline-flex items-center gap-2 bg-obsidian text-white px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-yellow-400 hover:text-black transition-all">
                    + Nuevo Producto
                </button>
            </div>`;
        contadorProductos.textContent = '';
        return;
    }

    if (btnHeader) btnHeader.classList.remove('hidden');

    const productos = obtenerProductosFiltrados();
    const totalVisibles = productosCache.filter(p => p.activo).length;
    const totalDestacados = productosCache.filter(p => p.destacado).length;
    const hayFiltrosActivos = !!(filtroBusquedaProductos.trim() || filtroEstadoProductos !== 'todos' || filtroCategoriaProductos);

    contadorProductos.textContent = hayFiltrosActivos
        ? `${productos.length} de ${productosCache.length} producto${productosCache.length === 1 ? '' : 's'} · ${totalVisibles} con stock en total · ${totalDestacados}/3 destacados`
        : `${productosCache.length} producto${productosCache.length === 1 ? '' : 's'} · ${totalVisibles} con stock · ${totalDestacados}/3 destacados`;

    // Hay productos en la cuenta, pero ninguno coincide con el filtro actual
    if (productos.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-3 py-24 text-center">
                <div class="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">🔎</div>
                <p class="text-slate-500 font-bold">No encontramos productos con esos filtros.</p>
                <p class="text-slate-400 text-sm">Probá con otra búsqueda o cambiá los filtros.</p>
                <button onclick="limpiarFiltrosProductos()" class="mt-2 inline-flex items-center gap-2 bg-slate-100 text-slate-700 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider hover:bg-slate-200 transition-all">
                    Limpiar filtros
                </button>
            </div>`;
        return;
    }

    grid.innerHTML = productos.map(p => `
        <div class="group bg-white rounded-xl sm:rounded-2xl border ${p.destacado ? 'border-yellow-400 ring-1 ring-yellow-400/70 shadow-md shadow-yellow-400/10' : 'border-slate-200 hover:border-slate-300'} shadow-sm hover:shadow-lg hover:shadow-slate-900/5 transition-all duration-300 overflow-hidden flex flex-col">
            <div class="relative aspect-square bg-slate-100 overflow-hidden">
                <img src="${urlGrillaProducto(p, 560)}" alt="${escapeHtml(p.nombre)}" class="w-full h-full object-contain group-hover:scale-[1.04] transition-transform duration-500" loading="lazy" decoding="async">
                <span class="absolute top-1.5 left-1.5 sm:top-2.5 sm:left-2.5 xl:top-3 xl:left-3 flex items-center gap-1 text-[8px] sm:text-[10px] xl:text-[11px] font-black uppercase tracking-wider px-1.5 py-0.5 sm:px-2.5 sm:py-1 xl:px-3 xl:py-1.5 rounded-full backdrop-blur-sm ${p.activo ? 'bg-emerald-500/90 text-white' : 'bg-slate-900/75 text-white'}">
                    <span class="w-1 h-1 sm:w-1.5 sm:h-1.5 xl:w-2 xl:h-2 rounded-full bg-white/90"></span>
                    ${p.activo ? 'Visible' : 'Sin stock'}
                </span>
                <button onclick="${(p.activo || p.destacado) ? `toggleDestacadoProducto('${p.id}', ${!!p.destacado})` : ''}" ${(p.activo || p.destacado) ? '' : 'disabled'} title="${p.activo ? (p.destacado ? 'Quitar de destacados' : 'Marcar como destacado') : (p.destacado ? 'Quitar de destacados' : 'No disponible: sin stock')}"
                    class="absolute top-1.5 right-1.5 sm:top-2.5 sm:right-2.5 xl:top-3 xl:right-3 w-6 h-6 sm:w-7 sm:h-7 xl:w-9 xl:h-9 rounded-full flex items-center justify-center transition-all backdrop-blur-sm ${p.destacado ? 'bg-yellow-400 text-black shadow-md shadow-yellow-400/50' : (p.activo ? 'bg-black/35 text-white/85 hover:bg-black/55' : 'bg-black/20 text-white/40 cursor-not-allowed')}">
                    <svg class="w-3.5 h-3.5 sm:w-4 sm:h-4 xl:w-5 xl:h-5" viewBox="0 0 24 24" fill="${p.destacado ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3.6l2.47 5.15 5.58.8-4.03 4.03.95 5.72L12 16.5l-5 2.8.95-5.72-4.03-4.03 5.58-.8L12 3.6z"/>
                    </svg>
                </button>
                ${p.destacado ? `
                <span class="absolute bottom-1.5 left-1.5 sm:bottom-2.5 sm:left-2.5 xl:bottom-3 xl:left-3 flex items-center gap-1 text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full bg-yellow-400 text-black shadow-sm">
                    <svg class="w-2.5 h-2.5 sm:w-3 sm:h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.6 5.27 5.82.85-4.21 4.1.99 5.8L12 15.8l-5.2 2.72.99-5.8-4.21-4.1 5.82-.85L12 2.5z"/></svg>
                    Destacado
                </span>` : ''}
                ${esProductoNuevoVigente(p) ? `
                <span title="Le quedan ${diasRestantesNuevo(p)} día${diasRestantesNuevo(p) === 1 ? '' : 's'} de cartel Nuevo" class="absolute bottom-1.5 right-1.5 sm:bottom-2.5 sm:right-2.5 xl:bottom-3 xl:right-3 flex items-center gap-1 text-[8px] sm:text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full bg-sky-500 text-white shadow-sm">
                    Nuevo · ${diasRestantesNuevo(p)}d
                </span>` : ''}
            </div>
            <div class="p-2 sm:p-3.5 xl:p-4 2xl:p-5 flex flex-col gap-0.5 sm:gap-1 xl:gap-1.5 flex-1">
                <span class="text-[8px] sm:text-[10px] xl:text-[11px] font-bold text-slate-400 uppercase tracking-widest truncate">${escapeHtml(nombreCategoriaDeProducto(p))}</span>
                <h3 class="font-bold sm:font-extrabold text-slate-900 text-xs sm:text-sm xl:text-[15px] 2xl:text-[17px] leading-snug line-clamp-2">${escapeHtml(p.nombre)}</h3>
                <div class="pt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span class="font-black text-sm sm:text-base xl:text-xl 2xl:text-[22px] text-slate-900">${formatoPrecio(p.precio)}</span>
                    ${calcularDescuentoPorcentaje(p.precio_anterior, p.precio) > 0 ? `
                        <span class="text-[10px] sm:text-xs xl:text-sm font-bold text-slate-400 line-through">${formatoPrecio(p.precio_anterior)}</span>
                        <span class="text-[8px] sm:text-[9px] xl:text-[11px] font-black uppercase tracking-wider px-1.5 py-0.5 xl:px-2 xl:py-1 rounded-full bg-red-600 text-white">-${calcularDescuentoPorcentaje(p.precio_anterior, p.precio)}% OFF</span>
                    ` : ''}
                </div>
                <div class="mt-auto pt-1.5 sm:pt-2 xl:pt-3 flex items-center gap-1 sm:gap-1.5 xl:gap-2 border-t border-slate-100 -mx-2 sm:-mx-3.5 xl:-mx-4 2xl:-mx-5 px-2 sm:px-3.5 xl:px-4 2xl:px-5 pt-2">
                    <button onclick="toggleActivoProducto('${p.id}', ${p.activo})" title="${p.activo ? 'Ocultar' : 'Mostrar'}" class="flex-1 h-7 sm:h-8 xl:h-10 rounded-lg xl:rounded-xl bg-slate-50 text-slate-600 ${p.activo ? 'hover:bg-slate-700 hover:text-white' : 'hover:bg-emerald-500 hover:text-white'} flex items-center justify-center transition-colors">
                        ${p.activo
                            ? `<svg class="w-3.5 h-3.5 xl:w-[18px] xl:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`
                            : `<svg class="w-3.5 h-3.5 xl:w-[18px] xl:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.774 3.162 10.066 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>`}
                    </button>
                    <button onclick="copiarLinkProducto('${p.id}')" title="Copiar link para compartir" class="flex-1 h-7 sm:h-8 xl:h-10 rounded-lg xl:rounded-xl bg-slate-50 text-slate-600 hover:bg-sky-500 hover:text-white flex items-center justify-center transition-colors">
                        <svg class="w-3.5 h-3.5 xl:w-[18px] xl:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
                    </button>
                    <button onclick="editarProducto('${p.id}')" title="Editar" class="flex-1 h-7 sm:h-8 xl:h-10 rounded-lg xl:rounded-xl bg-slate-50 text-slate-600 hover:bg-yellow-400 hover:text-black flex items-center justify-center transition-colors">
                        <svg class="w-3.5 h-3.5 xl:w-[18px] xl:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                    </button>
                    <button onclick="eliminarProducto('${p.id}')" title="Eliminar" class="flex-1 h-7 sm:h-8 xl:h-10 rounded-lg xl:rounded-xl bg-slate-50 text-slate-600 hover:bg-red-500 hover:text-white flex items-center justify-center transition-colors">
                        <svg class="w-3.5 h-3.5 xl:w-[18px] xl:h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// Arma el link público del producto (perfil del emprendedor con el modal
// del producto abierto automáticamente) y lo copia al portapapeles.
function copiarLinkProducto(id) {
    copiarAlPortapapeles(`${urlPerfilPublico()}&producto=${encodeURIComponent(id)}`, 'Link del producto copiado. ¡Ya lo podés compartir!');
}

// Arma el link público de la tienda del emprendedor (dropea.com.ar/tienda?t=<usuario>).
// Se usa tanto para "Ir a mi perfil" como para compartir el link de un producto.
// Usa SITIO_PUBLICO (definido en supabase-client.js) en vez de window.location.origin,
// porque el dashboard vive en un dominio distinto (Vercel) al del sitio público
// (Cloudflare), donde realmente está emprendedor.html.
function urlPerfilPublico() {
    return `${SITIO_PUBLICO}/tienda?t=${encodeURIComponent(String(perfilActual.usuario).trim().toLowerCase())}`;
}

// Copia el link público del perfil (el mismo que abre "Ver perfil") al
// portapapeles, para compartirlo directo por WhatsApp, redes, etc.
let timeoutCopiadoPerfil = null;
function copiarLinkPerfil() {
    copiarAlPortapapeles(urlPerfilPublico(), '¡Copiado! Ya lo podés compartir');
    mostrarCopiadoBotonCompartir();
    marcarPerfilCompartido();
}

// Feedback en el botón amarillo del menú: pasa a verde con un tilde y
// "¡Copiado!" unos segundos, y después vuelve a su estado normal.
function mostrarCopiadoBotonCompartir() {
    const btn = document.getElementById('btn-compartir-perfil');
    const texto = document.getElementById('btn-compartir-perfil-texto');
    const icono = document.getElementById('btn-compartir-perfil-icono');
    if (!btn || !texto || !icono) return;

    if (!btn.dataset.iconoOriginal) btn.dataset.iconoOriginal = icono.innerHTML;
    clearTimeout(timeoutCopiadoPerfil);

    btn.classList.remove('bg-yellow-400', 'hover:bg-yellow-300');
    btn.classList.add('bg-emerald-400', 'hover:bg-emerald-400');
    texto.textContent = '¡Copiado! Ya lo podés compartir';
    icono.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8" d="M5 13l4 4L19 7"/>';

    timeoutCopiadoPerfil = setTimeout(() => {
        btn.classList.remove('bg-emerald-400', 'hover:bg-emerald-400');
        btn.classList.add('bg-yellow-400', 'hover:bg-yellow-300');
        texto.textContent = 'Copiar link de mi perfil';
        icono.innerHTML = btn.dataset.iconoOriginal;
    }, 2500);
}

// ============================================================
// INICIO (portada del panel)
// ============================================================
// El paso "Compartí tu perfil" no tiene un dato en la base que lo confirme,
// así que se marca como hecho cuando el comercio copia o envía el link
// desde este dispositivo (localStorage).
function claveCompartido() {
    return `dropea_perfil_compartido_${perfilActual ? perfilActual.id : ''}`;
}
function haCompartidoPerfil() {
    try { return localStorage.getItem(claveCompartido()) === '1'; } catch (e) { return false; }
}
function marcarPerfilCompartido() {
    try { localStorage.setItem(claveCompartido(), '1'); } catch (e) { /* sin storage: el paso queda pendiente */ }
    renderInicio();
}

function compartirPerfilWhatsApp() {
    const texto = `Mirá mi tienda en Dropea: ${urlPerfilPublico()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
    marcarPerfilCompartido();
}

function pasosInicio() {
    const e = emprendedorActual || {};
    const tieneLogo = !!(e.logo_url || '').trim();
    const nProd = productosCache.length;
    const nCat = categoriasTienda.length;
    const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
    return [
        {
            titulo: 'Completá tus datos',
            desc: (tieneLogo && perfilTieneContacto()) ? 'Logo y WhatsApp cargados.' : 'Subí tu logo y cargá tu WhatsApp para que te contacten.',
            hecho: tieneLogo && perfilTieneContacto(),
            accion: "mostrarSeccion('perfil')", boton: 'Ir a Mis datos', botonHecho: 'Editar',
        },
        {
            titulo: 'Cargá tus productos',
            desc: nProd ? `${plural(nProd, 'producto cargado', 'productos cargados')}.` : 'Sumá al menos uno con foto y precio.',
            hecho: nProd > 0,
            accion: nProd ? "mostrarSeccion('productos')" : 'abrirFormulario()', boton: 'Cargar producto', botonHecho: 'Ver productos',
        },
        {
            titulo: 'Armá tus categorías',
            desc: nCat ? `${plural(nCat, 'categoría creada', 'categorías creadas')}.` : 'Ordená tu catálogo para que se encuentre más fácil.',
            hecho: nCat > 0,
            accion: "mostrarSeccion('categorias')", boton: 'Crear categorías', botonHecho: 'Ver categorías',
        },
        {
            titulo: 'Sumá un anuncio',
            desc: (e.anuncio || '').trim() ? 'Tu anuncio se ve arriba del perfil.' : 'Un aviso corto arriba de tu perfil: novedades, envíos, vacaciones.',
            hecho: !!(e.anuncio || '').trim(),
            opcional: true,
            accion: "mostrarSeccion('anuncios')", boton: 'Crear anuncio', botonHecho: 'Editar',
        },
        {
            titulo: 'Compartí tu perfil',
            desc: haCompartidoPerfil() ? 'Ya compartiste tu link.' : 'Copiá el link y pasalo por WhatsApp o redes.',
            hecho: haCompartidoPerfil(),
            accion: 'copiarLinkPerfil()', boton: 'Copiar link', botonHecho: 'Copiar de nuevo',
        },
    ];
}

// ------------------------------------------------------------
// MENSAJES DE BIENVENIDA
// Cada vez que se entra al panel se elige un saludo distinto (según la hora
// del día y cómo viene la tienda). Se sortea UNA vez por carga de página, así
// el texto no cambia solo mientras se usa el panel. Se guarda el último
// saludo y la cantidad de ingresos en localStorage (si no hay storage, igual
// funciona: sólo que puede repetirse).
// ------------------------------------------------------------
const SALUDOS_BIENVENIDA = {
    manana: ['Buenos días, {n}', '¡Buen día, {n}!', '{n}, ¡arrancamos el día!', 'Qué bueno verte temprano, {n}', '¡Hola, {n}! Que sea un gran día', 'Buen día, {n}. ¡A vender!'],
    tarde:  ['Buenas tardes, {n}', '¡Hola de nuevo, {n}!', 'Qué bueno verte, {n}', '{n}, ¡vamos con todo esta tarde!', '¡Bienvenido otra vez, {n}!', 'Hola, {n}. ¿Cómo viene la tarde?'],
    noche:  ['Buenas noches, {n}', '¡Hola, {n}! Un repaso antes de cerrar el día', 'Qué bueno tenerte por acá, {n}', '{n}, cerrando el día con todo', '¡Hola, {n}! Tu tienda sigue trabajando', 'Buenas noches, {n}. ¡Un gusto verte!'],
};
const SUBTITULOS_BIENVENIDA = {
    primera: ['Es tu primera vez por acá: te guiamos paso a paso para armar tu tienda.'],
    nueva: [
        'Armemos tu tienda paso a paso. Empezá cargando tu primer producto.',
        'Tu tienda está arrancando: en pocos pasos queda lista para compartir.',
        'Todo gran catálogo empieza con un primer producto. ¿Cargamos el tuyo?',
        'Estás a unos pasos de tener tu tienda online.',
    ],
    progreso: [
        'Vas muy bien: ya completaste {h} de {t} pasos.',
        'Ya falta poco para que tu tienda quede lista.',
        'Seguí con el próximo paso y tu tienda queda lista para compartir.',
        'Buen avance: {h} de {t} pasos listos.',
    ],
    lista: [
        'Tu tienda está lista. Compartila para que tus clientes la encuentren.',
        'Tu catálogo está al día. ¡Mostralo al mundo!',
        'Todo listo por acá. Pasale el link a tus clientes y a vender.',
        'Tu tienda está online y esperando clientes.',
    ],
    bloqueada: ['Tu tienda está bloqueada por ahora. Mirá el aviso del panel para ver cómo resolverlo.'],
};
// Un toque extra según el día de la semana (0 = domingo)
const SUBTITULOS_POR_DIA = {
    1: 'Arrancamos la semana: un buen momento para sumar novedades.',
    5: '¡Llegó el viernes! Buen momento para compartir tu tienda.',
    6: 'Fin de semana: ideal para que más gente conozca tu tienda.',
    0: 'Domingo de tienda: tus clientes también miran el celular.',
};

let semillaBienvenida = null;
let esPrimeraVisita = false;
function iniciarSemillaBienvenida() {
    if (semillaBienvenida !== null) return;
    const kVisitas = `dropea_visitas_${perfilActual.id}`;
    const kUltimo = `dropea_ultimo_saludo_${perfilActual.id}`;
    let visitas = 0, ultimo = -1;
    try {
        visitas = parseInt(localStorage.getItem(kVisitas) || '0', 10) || 0;
        const u = parseInt(localStorage.getItem(kUltimo), 10);
        ultimo = Number.isNaN(u) ? -1 : u;
        localStorage.setItem(kVisitas, String(visitas + 1));
    } catch (e) { /* sin storage: se sortea igual */ }
    esPrimeraVisita = visitas === 0;

    let semilla = Math.floor(Math.random() * 997);
    // El saludo se elige con semilla % 6: así no repetimos el del ingreso anterior.
    if (ultimo >= 0 && semilla % 6 === ultimo % 6) semilla += 1;
    semillaBienvenida = semilla;
    try { localStorage.setItem(kUltimo, String(semilla)); } catch (e) { /* idem */ }
}

function textoBienvenida({ nombre, hechos, total, listo, bloqueada, nProductos }) {
    iniciarSemillaBienvenida();
    const ahora = new Date();
    const hora = ahora.getHours();
    const franja = hora >= 6 && hora < 12 ? 'manana' : (hora >= 12 && hora < 20 ? 'tarde' : 'noche');
    const emoji = franja === 'manana' ? '☀️' : (franja === 'tarde' ? '🌤️' : '🌙');
    const fmt = (t) => t.replace('{n}', nombre).replace('{h}', hechos).replace('{t}', total);

    const titulo = (esPrimeraVisita && !listo && !bloqueada)
        ? `¡Bienvenido a Dropea, ${nombre}!`
        : fmt(SALUDOS_BIENVENIDA[franja][semillaBienvenida % SALUDOS_BIENVENIDA[franja].length]);

    let pool;
    if (bloqueada) pool = SUBTITULOS_BIENVENIDA.bloqueada;
    else if (esPrimeraVisita && !listo) pool = SUBTITULOS_BIENVENIDA.primera;
    else if (listo) pool = SUBTITULOS_BIENVENIDA.lista.concat(SUBTITULOS_POR_DIA[ahora.getDay()] || []);
    else if (nProductos === 0) pool = SUBTITULOS_BIENVENIDA.nueva;
    else pool = SUBTITULOS_BIENVENIDA.progreso;
    const subtitulo = fmt(pool[Math.floor(semillaBienvenida / 6) % pool.length]);

    const fecha = ahora.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    return { titulo, subtitulo, emoji, fecha };
}

// Avatar de la bienvenida: logo si hay, y si no la inicial de la tienda.
function pintarAvatarBienvenida(nombre, logoUrl) {
    const letra = document.getElementById('inicio-avatar-letra');
    const img = document.getElementById('inicio-avatar-img');
    if (!letra || !img) return;
    letra.textContent = (nombre || '?').charAt(0).toUpperCase();
    const url = (logoUrl || '').trim();
    if (!url) {
        img.classList.add('hidden');
        letra.classList.remove('hidden');
        return;
    }
    if (img.dataset.src === url) return; // ya cargado, evitamos parpadeo en cada re-render
    img.dataset.src = url;
    img.onload = () => { img.classList.remove('hidden'); letra.classList.add('hidden'); };
    img.onerror = () => { img.classList.add('hidden'); letra.classList.remove('hidden'); };
    img.src = url;
}

function renderInicio() {
    const secInicio = document.getElementById('section-inicio');
    if (!secInicio || !perfilActual || !emprendedorActual) return;
    if (!(inicioCargado.perfil && inicioCargado.productos && inicioCargado.categorias)) return;

    // ---- Bienvenida ----
    const nombre = (emprendedorActual.nombre_tienda || '').trim() || perfilActual.usuario;
    const pasos = pasosInicio();
    const obligatorios = pasos.filter(p => !p.opcional);
    const hechos = obligatorios.filter(p => p.hecho).length;
    const listo = hechos === obligatorios.length;
    const indiceSiguiente = pasos.findIndex(p => !p.opcional && !p.hecho);
    const acceso = calcularEstadoAcceso(emprendedorActual);

    const bienvenida = textoBienvenida({
        nombre, hechos, total: obligatorios.length, listo,
        bloqueada: !!acceso.bloqueado, nProductos: productosCache.length,
    });
    const fechaCapitalizada = bienvenida.fecha.charAt(0).toUpperCase() + bienvenida.fecha.slice(1);
    // "Tu panel" y la fecha van en spans aparte: en pantallas angostas se apilan en dos líneas
    // (la fecha nunca se corta); desde sm van en una sola línea separados por un punto.
    const saludoTexto = document.getElementById('inicio-saludo-texto');
    const spanPanel = document.createElement('span');
    spanPanel.textContent = 'Tu panel';
    const spanPunto = document.createElement('span');
    spanPunto.className = 'hidden sm:inline';
    spanPunto.textContent = '·';
    const spanFecha = document.createElement('span');
    spanFecha.className = 'text-yellow-400/70 sm:text-yellow-400';
    spanFecha.textContent = fechaCapitalizada;
    saludoTexto.replaceChildren(spanPanel, spanPunto, spanFecha);
    document.getElementById('inicio-titulo').textContent = bienvenida.titulo;
    document.getElementById('inicio-subtitulo').textContent = bienvenida.subtitulo;
    document.getElementById('inicio-momento').textContent = bienvenida.emoji;
    document.getElementById('inicio-momento').classList.remove('opacity-0');
    pintarAvatarBienvenida(nombre, emprendedorActual.logo_url);

    // ---- Estado de la tienda ----
    const visibles = productosCache.filter(p => p.activo).length;
    const sinStock = productosCache.length - visibles;
    const destacados = productosCache.filter(p => p.destacado).length;

    let estado = { texto: 'Tu tienda está online', clasePill: 'bg-emerald-400/15 text-emerald-300', clasePunto: 'bg-emerald-400' };
    if (acceso.bloqueado) {
        estado = { texto: 'Tu tienda está bloqueada', clasePill: 'bg-red-500/20 text-red-300', clasePunto: 'bg-red-400' };
    } else if (visibles === 0) {
        estado = { texto: 'Todavía sin productos visibles', clasePill: 'bg-yellow-400/15 text-yellow-300', clasePunto: 'bg-yellow-400' };
    }
    const pill = document.getElementById('inicio-estado');
    pill.className = `self-start inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-wider px-3 py-1.5 rounded-full ${estado.clasePill}`;
    document.getElementById('inicio-estado-punto').className = `w-2 h-2 rounded-full ${estado.clasePunto}`;
    document.getElementById('inicio-estado-texto').textContent = estado.texto;

    // ---- Acceso rápido para pagar (solo si la tienda está bloqueada por vencimiento) ----
    // Si el bloqueo lo puso el admin a mano, pagar no lo resuelve: no se muestra.
    const cajaPago = document.getElementById('inicio-pago-rapido');
    if (cajaPago) {
        const vencidaPorPago = !!acceso.bloqueado && acceso.motivo === 'pago';
        cajaPago.classList.toggle('hidden', !vencidaPorPago);
        if (vencidaPorPago) {
            document.getElementById('inicio-pago-rapido-titulo').textContent = acceso.enPruebaGratis
                ? 'Tu mes gratis terminó'
                : 'Tu suscripción venció';
            const venc = acceso.vencimiento ? ` (venció el ${acceso.vencimiento.toLocaleDateString('es-AR')})` : '';
            document.getElementById('inicio-pago-rapido-texto').textContent = acceso.enPruebaGratis
                ? `Tu tienda dejó de mostrarse en Dropea${venc}. Activá tu suscripción para que vuelva a aparecer.`
                : `Tu tienda dejó de mostrarse en Dropea${venc}. Renová tu suscripción para que vuelva a aparecer.`;
        }
    }

    // ---- Checklist ----
    document.getElementById('inicio-checklist').classList.toggle('hidden', listo);
    const mostrarListo = listo && !acceso.bloqueado;
    document.getElementById('inicio-listo').classList.toggle('hidden', !mostrarListo);
    document.getElementById('inicio-listo').classList.toggle('flex', mostrarListo);
    document.getElementById('inicio-listo-texto').textContent = (emprendedorActual.anuncio || '').trim()
        ? 'Completaste todos los pasos. Cada vez que cargues productos nuevos, volvé a compartir el link.'
        : 'Completaste todos los pasos. Tip: un anuncio arriba de tu perfil sirve para avisar novedades.';
    document.getElementById('inicio-progreso-texto').textContent = `${hechos} de ${obligatorios.length}`;
    document.getElementById('inicio-progreso-barra').style.width = `${Math.round((hechos / obligatorios.length) * 100)}%`;

    const iconoCheck = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
    let numero = 0;
    document.getElementById('inicio-pasos').innerHTML = pasos.map((p, i) => {
        const esSiguiente = i === indiceSiguiente;
        if (!p.opcional) numero++;
        const circulo = p.hecho
            ? 'bg-emerald-500 text-white'
            : (esSiguiente ? 'bg-yellow-400 text-black' : 'bg-slate-100 text-slate-400');
        const contenidoCirculo = p.hecho ? iconoCheck : (p.opcional ? '+' : numero);
        const btnClase = p.hecho
            ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            : (esSiguiente ? 'bg-obsidian text-white hover:bg-black' : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50');
        return `
            <li class="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${esSiguiente ? 'border-yellow-400 bg-yellow-50/60' : 'border-slate-200 bg-white'}">
                <span class="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-black ${circulo}">${contenidoCirculo}</span>
                <div class="flex-1 min-w-0">
                    <p class="font-extrabold text-sm text-slate-900 leading-snug">${p.titulo}${p.opcional ? ' <span class="ml-1 align-middle text-[9px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">Opcional</span>' : ''}</p>
                    <p class="text-xs text-slate-400 mt-0.5 leading-snug">${p.desc}</p>
                </div>
                <button type="button" onclick="${p.accion}" class="flex-shrink-0 px-3 sm:px-4 py-2 rounded-full font-black text-[10px] sm:text-[11px] uppercase tracking-wider transition-all ${btnClase}">${p.hecho ? p.botonHecho : p.boton}</button>
            </li>`;
    }).join('');

    // ---- Resumen ----
    document.getElementById('inicio-stat-visibles').textContent = visibles;
    document.getElementById('inicio-stat-sinstock').textContent = sinStock;
    document.getElementById('inicio-stat-destacados').textContent = `${destacados}/${MAX_PRODUCTOS_DESTACADOS}`;
    document.getElementById('inicio-stat-categorias').textContent = categoriasTienda.length;

    // ---- Para mejorar tu catálogo ----
    const sinFoto = productosCache.filter(p => !(p.imagen_url || '').trim()).length;
    const sinCategoria = categoriasTienda.length > 0 ? productosCache.filter(p => p.categoria_tienda_id == null).length : 0;
    const avisos = [];
    if (sinFoto) avisos.push({ texto: `${sinFoto} producto${sinFoto === 1 ? '' : 's'} sin foto`, detalle: 'Con foto se venden bastante más.', accion: "mostrarSeccion('productos')" });
    if (sinCategoria) avisos.push({ texto: `${sinCategoria} producto${sinCategoria === 1 ? '' : 's'} sin categoría`, detalle: 'Asignales una para que se encuentren fácil.', accion: "mostrarSeccion('productos')" });
    if (sinStock) avisos.push({ texto: `${sinStock} producto${sinStock === 1 ? '' : 's'} sin stock`, detalle: 'No se muestran en tu perfil hasta que los reactives.', accion: "mostrarSeccion('productos')" });
    if (visibles > 0 && destacados === 0) avisos.push({ texto: 'Todavía no destacaste ningún producto', detalle: `Podés destacar hasta ${MAX_PRODUCTOS_DESTACADOS} para que aparezcan primero.`, accion: "mostrarSeccion('productos')" });

    document.getElementById('inicio-revisar').classList.toggle('hidden', avisos.length === 0);
    document.getElementById('inicio-revisar-lista').innerHTML = avisos.map(a => `
        <li class="flex items-center gap-3 py-3">
            <div class="flex-1 min-w-0">
                <p class="font-bold text-sm text-slate-900">${a.texto}</p>
                <p class="text-xs text-slate-400 mt-0.5">${a.detalle}</p>
            </div>
            <button type="button" onclick="${a.accion}" class="flex-shrink-0 px-3 sm:px-4 py-2 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 font-black text-[10px] sm:text-[11px] uppercase tracking-wider transition-all">Revisar</button>
        </li>`).join('');
}

// ============================================================
// MEDIOS DE PAGO
// ============================================================
function renderMediosPagoPerfil() {
    const cont = document.getElementById('medios-pago-perfil');
    cont.innerHTML = MEDIOS_PAGO.map(m => `
        <button type="button" onclick="toggleMedioPagoPerfil('${m.id}')"
            class="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border-2 text-xs font-bold transition-all ${mediosPagoPerfilSeleccion.includes(m.id) ? 'bg-obsidian text-white border-obsidian' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}">
            <span>${m.icon}</span><span>${m.label}</span>
        </button>
    `).join('');
}

function toggleMedioPagoPerfil(id) {
    mediosPagoPerfilSeleccion = mediosPagoPerfilSeleccion.includes(id)
        ? mediosPagoPerfilSeleccion.filter(x => x !== id)
        : [...mediosPagoPerfilSeleccion, id];
    renderMediosPagoPerfil();
}

function renderMediosPagoProducto() {
    const cont = document.getElementById('medios-pago-producto');
    const disponibles = MEDIOS_PAGO.filter(m => (emprendedorActual?.medios_pago || []).includes(m.id));

    if (disponibles.length === 0) {
        cont.innerHTML = `<p class="field-hint" style="margin:0;">Todavía no configuraste medios de pago en <button type="button" onclick="mostrarSeccion('perfil'); cerrarFormulario();" style="text-decoration:underline; font-weight:700; color:inherit; background:none; border:none; cursor:pointer; padding:0;">Mi Perfil</button>.</p>`;
        return;
    }

    cont.innerHTML = disponibles.map(m => `
        <button type="button" onclick="toggleMedioPagoProducto('${m.id}')"
            class="tag-chip ${mediosPagoProductoSeleccion.includes(m.id) ? 'selected' : ''}">
            <span>${m.icon}</span><span>${m.label}</span>
        </button>
    `).join('');
}

function toggleMedioPagoProducto(id) {
    mediosPagoProductoSeleccion = mediosPagoProductoSeleccion.includes(id)
        ? mediosPagoProductoSeleccion.filter(x => x !== id)
        : [...mediosPagoProductoSeleccion, id];
    renderMediosPagoProducto();
}

// ============================================================
// DATOS OBLIGATORIOS ANTES DE SUBIR PRODUCTOS
// ============================================================
// Sin WhatsApp cargado, el comprador no tiene como contactar al
// emprendedor y los pedidos no llegan. Por eso, antes de abrir el
// formulario de "Nuevo producto" verificamos que el contacto exista.
// En la base el WhatsApp se guarda como "549" + caracteristica + numero.
function perfilTieneContacto() {
    const digitos = ((emprendedorActual && emprendedorActual.whatsapp) || '')
        .replace(/\D/g, '')
        .replace(/^549/, '');
    return digitos.length >= 8;
}

function mostrarModalDatosRequeridos() {
    const m = document.getElementById('modal-datos-requeridos');
    if (!m) return;
    m.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalDatosRequeridos() {
    const m = document.getElementById('modal-datos-requeridos');
    if (!m) return;
    m.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function irACompletarDatos() {
    cerrarModalDatosRequeridos();
    mostrarSeccion('perfil');
    // Llevamos al emprendedor directo al campo que falta.
    setTimeout(() => {
        const input = document.getElementById('p-whatsapp');
        if (!input) return;
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        input.focus({ preventScroll: true });
    }, 120);
}

// ============================================================
// MODAL: ABRIR / CERRAR
// ============================================================
function abrirFormulario() {
    // Sin contacto cargado no se puede crear un producto nuevo.
    if (!perfilTieneContacto()) {
        mostrarModalDatosRequeridos();
        return;
    }
    productoEditandoId = null;
    imagenThumbUrlActual = '';
    variantesEnEdicion = [];
    variantesEliminadas = [];
    mediosPagoProductoSeleccion = [];
    document.getElementById('titulo-modal').textContent = 'Nuevo producto';
    form.reset();
    document.getElementById('imagen').value = '';
    document.getElementById('activo').checked = true;
    document.getElementById('nuevo').checked = false;
    actualizarPreviewImagenProducto('');
    renderVariantes();
    renderMediosPagoProducto();
    modal.classList.add('open');
    document.body.classList.add('overflow-hidden');
    document.getElementById('cuerpo-modal-producto').scrollTop = 0;
    ajustarModalAlViewportVisible();
    ajustarTextareasAutogrow();
}

// ============================================================
// TECLADO VIRTUAL EN MOBILE — el modal se ajusta al alto real
// ============================================================
// Muchos navegadores (sobre todo Android) NO achican el layout viewport
// cuando aparece el teclado, así que el 100dvh del modal se queda igual
// de grande y el teclado tapa el campo activo sin dejar nada para
// scrollear. Usamos la Visual Viewport API para conocer el alto
// realmente visible y achicar el modal a ese tamaño en tiempo real;
// así el campo enfocado siempre queda dentro del área con scroll.
let _rafModalForm = null;
function ajustarModalAlViewportVisible() {
    if (!window.visualViewport || !modal.classList.contains('open')) return;
    // Throttle con requestAnimationFrame: durante la animación del teclado
    // este evento puede dispararse decenas de veces por segundo, y cada
    // corrida fuerza un recalculo de layout (cambia una CSS var de la que
    // dependen max-height de varios elementos). Sin este throttle, eso es
    // lo que se siente como "lag" al abrir/cerrar el teclado.
    if (_rafModalForm) return;
    _rafModalForm = requestAnimationFrame(() => {
        _rafModalForm = null;
        const vv = window.visualViewport;
        document.documentElement.style.setProperty('--app-height', vv.height + 'px');
        // En iOS, al abrirse el teclado el viewport visual puede desplazarse
        // respecto del layout viewport; corregimos el offset para que el
        // modal (position: fixed) no quede "corrido" hacia arriba o abajo.
        modal.style.top = vv.offsetTop + 'px';
    });
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustarModalAlViewportVisible);
    window.visualViewport.addEventListener('scroll', ajustarModalAlViewportVisible);
}

// Al enfocar un campo dentro del modal, lo centramos en la zona visible.
// Esperamos al evento "resize" del visualViewport (que se dispara cuando
// el teclado termina de abrirse) en vez de un timeout fijo, con un
// timeout de respaldo por si el teclado ya estaba abierto y no hay resize.
document.getElementById('cuerpo-modal-producto').addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el.matches('input, textarea, select')) return;

    const centrarCampo = () => el.scrollIntoView({ block: 'center', behavior: 'smooth' });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', centrarCampo, { once: true });
        setTimeout(centrarCampo, 350); // respaldo si el teclado ya estaba abierto
    } else {
        setTimeout(centrarCampo, 300);
    }
});

function cerrarFormulario() {
    modal.classList.remove('open');
    modal.style.top = '';
    form.reset();
    document.getElementById('imagen').value = '';
    imagenThumbUrlActual = '';
    productoEditandoId = null;
    variantesEnEdicion = [];
    variantesEliminadas = [];
    mediosPagoProductoSeleccion = [];
    actualizarPreviewImagenProducto('');
    document.body.classList.remove('overflow-hidden');
}

// ============================================================
// SUBIDA DE IMAGEN — PRODUCTO (Supabase Storage)
// ============================================================
async function manejarSeleccionImagenProducto(event) {
    const file = event.target.files[0];
    if (!file) return;

    const errorValidacion = validarImagenSeleccionada(file);
    if (errorValidacion) {
        mostrarToast(errorValidacion, 'error');
        event.target.value = '';
        return;
    }

    const urlAnterior = document.getElementById('imagen').value;
    const thumbAnterior = imagenThumbUrlActual;
    mostrarSpinnerImagen('imagen-producto', true);
    try {
        const { url, thumbUrl } = await subirImagenProductoSupabase(file, perfilActual.id);
        document.getElementById('imagen').value = url;
        imagenThumbUrlActual = thumbUrl || '';
        actualizarPreviewImagenProducto(url);
        // Si estábamos reemplazando una foto subida por este mismo sistema, borramos la
        // vieja (nunca la default, que es compartida por todos los productos sin foto)
        if (urlAnterior && urlAnterior !== IMAGEN_PRODUCTO_DEFAULT) borrarImagenProductoSupabase(urlAnterior, thumbAnterior);
    } catch (err) {
        console.error(err);
        mostrarToast('No se pudo subir la imagen. Probá de nuevo.', 'error');
    } finally {
        mostrarSpinnerImagen('imagen-producto', false);
        event.target.value = '';
    }
}

function mostrarSpinnerImagen(prefijo, mostrar) {
    const spinner = document.getElementById(`${prefijo}-spinner`);
    if (spinner) spinner.classList.toggle('hidden', !mostrar);
}

async function editarProducto(id) {
    const { data: p, error } = await supabase.from('productos').select('*').eq('id', id).single();
    if (error) { mostrarToast('No se pudo cargar el producto.', 'error'); return; }

    const { data: vs } = await supabase.from('variantes').select('*').eq('producto_id', id);

    productoEditandoId = id;
    variantesEnEdicion = (vs || []).map(v => ({ ...v }));
    variantesEliminadas = [];
    mediosPagoProductoSeleccion = p.medios_pago || [];

    document.getElementById('titulo-modal').textContent = 'Editar producto';
    document.getElementById('nombre').value = p.nombre;
    document.getElementById('precio').value = formatoPrecioInput(p.precio);
    document.getElementById('precio_anterior').value = p.precio_anterior ? formatoPrecioInput(p.precio_anterior) : '';
    document.getElementById('categoria-tienda').value = p.categoria_tienda_id != null ? String(p.categoria_tienda_id) : '';
    document.getElementById('imagen').value = p.imagen_url || '';
    imagenThumbUrlActual = p.imagen_thumb_url || '';
    document.getElementById('descripcion').value = p.descripcion || '';
    document.getElementById('activo').checked = p.activo;
    document.getElementById('nuevo').checked = !!p.nuevo;
    actualizarPreviewImagenProducto(p.imagen_url);

    renderVariantes();
    renderMediosPagoProducto();
    modal.classList.add('open');
    document.body.classList.add('overflow-hidden');
    document.getElementById('cuerpo-modal-producto').scrollTop = 0;
    ajustarModalAlViewportVisible();
    ajustarTextareasAutogrow();
}

// Muestra la preview de la imagen del producto (o el placeholder si está vacía/URL inválida)
function actualizarPreviewImagenProducto(url) {
    const area = document.getElementById('imagen-producto-area');
    const img = document.getElementById('imagen-producto-preview');
    const placeholder = document.getElementById('imagen-producto-preview-placeholder');
    const acciones = document.getElementById('imagen-producto-actions');
    const valor = (url || '').trim();

    if (!valor) {
        img.classList.add('hidden');
        img.src = '';
        placeholder.classList.remove('hidden');
        area.classList.remove('has-image');
        acciones.classList.add('hidden');
        return;
    }

    img.onerror = () => {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
        area.classList.remove('has-image');
        acciones.classList.add('hidden');
    };
    img.onload = () => {
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
        area.classList.add('has-image');
        acciones.classList.remove('hidden');
    };
    img.src = valor;
}

// Quita la imagen cargada (vuelve al placeholder). Si era una imagen propia
// (no la default compartida), la borra también del storage.
function quitarImagenProducto() {
    const urlAnterior = document.getElementById('imagen').value;
    const thumbAnterior = imagenThumbUrlActual;
    document.getElementById('imagen').value = '';
    imagenThumbUrlActual = '';
    actualizarPreviewImagenProducto('');
    if (urlAnterior && urlAnterior !== IMAGEN_PRODUCTO_DEFAULT) borrarImagenProductoSupabase(urlAnterior, thumbAnterior);
}

// ============================================================
// VARIANTES (edición en memoria, se guardan al submit)
// ============================================================
function agregarFilaVariante() {
    variantesEnEdicion.push({ nombre: '', valor: '', precio_adicional: 0, disponible: true });
    renderVariantes();
}

function quitarFilaVariante(idx) {
    const v = variantesEnEdicion[idx];
    // Si ya existía guardada en Supabase (tiene id), la anotamos para borrarla
    // de la base al guardar; si es una fila nueva sin guardar, con sacarla
    // del array en memoria alcanza.
    if (v?.id) variantesEliminadas.push(v.id);
    variantesEnEdicion.splice(idx, 1);
    renderVariantes();
}

function actualizarCampoVariante(idx, campo, valor) {
    variantesEnEdicion[idx][campo] = valor;
}

// Precio final de esa variante: si el emprendedor cargó un precio propio para
// la combinación (ej: "Con caja" -> $60.000), se usa ese precio TAL CUAL, sin
// sumarle nada al precio base. Si lo deja vacío/en 0, esa variante no tiene un
// precio distinto y se cobra el precio base del producto.
function calcularTotalVariante(idx) {
    const base = parsearPrecio(document.getElementById('precio').value);
    const propio = parsearPrecio(variantesEnEdicion[idx]?.precio_adicional ?? 0);
    return propio > 0 ? propio : base;
}

function actualizarTotalVariante(idx) {
    const el = document.getElementById(`variant-total-${idx}`);
    if (el) el.textContent = `Precio final: ${formatoPrecio(calcularTotalVariante(idx))}`;
}

// Se llama cuando cambia el precio base: como el precio final de las variantes
// que no tienen precio propio depende de él, hay que refrescar totales Y el
// placeholder (que muestra el precio base como referencia de "si lo dejás
// vacío, se cobra esto").
function actualizarTodosLosTotalesVariantes() {
    const base = formatoPrecioInput(parsearPrecio(document.getElementById('precio').value || 0)) || '0';
    variantesEnEdicion.forEach((_, idx) => {
        actualizarTotalVariante(idx);
        const inputPrecio = document.getElementById(`variant-precio-${idx}`);
        if (inputPrecio) inputPrecio.placeholder = base;
    });
}

// Marca una variante como "con stock" o "sin stock". Sigue existiendo y
// editable, pero se muestra tachada y no seleccionable en la tienda pública.
function marcarStockVariante(idx, disponible) {
    variantesEnEdicion[idx].disponible = disponible;
    renderVariantes();
}

function renderVariantes() {
    if (variantesEnEdicion.length === 0) {
        listaVariantes.innerHTML = `
            <div class="empty-variants">
                <p>Sin variantes cargadas.</p>
                <button type="button" onclick="agregarFilaVariante()">+ Agregar la primera</button>
            </div>`;
        actualizarAvisoSinStock();
        return;
    }

    const encabezado = `
        <div class="variant-header">
            <span>Nombre</span>
            <span>Valor</span>
            <span>Precio</span>
            <span>Stock</span>
            <span></span>
        </div>`;

    listaVariantes.innerHTML = encabezado + variantesEnEdicion.map((v, idx) => {
        const sinStock = v.disponible === false;
        return `
        <div class="variant-row ${sinStock ? 'sin-stock' : ''}">
            <div class="variant-cell variant-cell-nombre">
                <input type="text" placeholder="Qué cambia" value="${escapeHtml(v.nombre)}"
                    oninput="actualizarCampoVariante(${idx}, 'nombre', this.value)">
            </div>
            <div class="variant-cell variant-cell-valor">
                <input type="text" placeholder="Opción" value="${escapeHtml(v.valor)}"
                    oninput="actualizarCampoVariante(${idx}, 'valor', this.value)">
            </div>
            <div class="variant-cell variant-cell-precio">
                <input type="text" inputmode="decimal" id="variant-precio-${idx}" placeholder="${formatoPrecioInput(parsearPrecio(document.getElementById('precio')?.value || 0)) || '0'}" value="${formatoPrecioInput(parsearPrecio(v.precio_adicional ?? 0)) === '0' ? '' : formatoPrecioInput(parsearPrecio(v.precio_adicional ?? 0))}"
                    oninput="sanitizarInputPrecio(this); actualizarCampoVariante(${idx}, 'precio_adicional', this.value); actualizarTotalVariante(${idx})"
                    onblur="formatearInputPrecio(this)">
                <span class="variant-total-hint" id="variant-total-${idx}">Precio final: ${formatoPrecio(calcularTotalVariante(idx))}</span>
            </div>
            <div class="variant-cell variant-cell-stock">
                <div class="variant-stock-btns">
                    <button type="button" class="variant-stock-btn ${sinStock ? '' : 'activo-on'}" onclick="marcarStockVariante(${idx}, true)"><span class="variant-stock-btn-dot"></span>Con stock</button>
                    <button type="button" class="variant-stock-btn ${sinStock ? 'activo-off' : ''}" onclick="marcarStockVariante(${idx}, false)"><span class="variant-stock-btn-dot"></span>Sin stock</button>
                </div>
            </div>
            <div class="variant-cell variant-cell-remove">
                <button type="button" onclick="quitarFilaVariante(${idx})" title="Quitar variante" class="variant-remove">✕</button>
            </div>
        </div>
    `;
    }).join('');

    actualizarAvisoSinStock();
}

// Muestra/oculta el aviso de "se va a ocultar el producto" en vivo, a medida
// que el emprendedor tilda/destilda variantes como sin stock (sin esperar a guardar).
function actualizarAvisoSinStock() {
    const aviso = document.getElementById('aviso-sin-stock');
    if (!aviso) return;
    const variantesValidas = variantesEnEdicion.filter(v => v.nombre?.trim() && v.valor?.trim());
    const todasSinStock = variantesValidas.length > 0 && variantesValidas.every(v => v.disponible === false);
    aviso.classList.toggle('hidden', !todasSinStock);
}

// ============================================================
// GUARDAR PRODUCTO (crear o editar) + sus variantes
// ============================================================
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // La imagen es opcional: si no subieron ninguna, usamos una foto
    // genérica para que la card del producto no quede vacía/rota.
    const imagenUrl = document.getElementById('imagen').value.trim() || IMAGEN_PRODUCTO_DEFAULT;

    const btn = document.getElementById('btn-guardar-producto');
    btn.disabled = true;
    btn.textContent = 'Guardando...';

    // Si el producto tiene variantes cargadas y TODAS quedaron marcadas como
    // "sin stock", no tiene sentido que siga visible en la tienda (no habría
    // nada seleccionable para comprar): lo ocultamos automáticamente aunque
    // el toggle "Visible en la tienda" haya quedado tildado.
    const variantesValidas = variantesEnEdicion.filter(v => v.nombre?.trim() && v.valor?.trim());
    const todasLasVariantesSinStock = variantesValidas.length > 0 && variantesValidas.every(v => v.disponible === false);
    const activoElegido = document.getElementById('activo').checked;
    const seOcultoAutomaticamente = todasLasVariantesSinStock && activoElegido;

    // Precio anterior (para mostrar tachado + % OFF en la tienda): es opcional,
    // pero si se carga tiene que ser mayor al precio actual, si no no hay
    // descuento que mostrar.
    const precioActual = parsearPrecio(document.getElementById('precio').value);
    const precioAnteriorTexto = document.getElementById('precio_anterior').value.trim();
    const precioAnterior = precioAnteriorTexto ? parsearPrecio(precioAnteriorTexto) : null;

    if (precioAnterior !== null && precioAnterior <= precioActual) {
        mostrarToast('El precio anterior tiene que ser mayor al precio actual para mostrarse como oferta.', 'error');
        btn.disabled = false;
        btn.textContent = 'Guardar';
        return;
    }

    const payload = {
        emprendedor_id: perfilActual.id,
        nombre: document.getElementById('nombre').value.trim(),
        precio: precioActual,
        precio_anterior: precioAnterior,
        categoria_tienda_id: parseInt(document.getElementById('categoria-tienda').value, 10) || null,
        imagen_url: imagenUrl,
        imagen_thumb_url: imagenThumbUrlActual || null,
        descripcion: document.getElementById('descripcion').value.trim(),
        activo: todasLasVariantesSinStock ? false : activoElegido,
        medios_pago: mediosPagoProductoSeleccion
    };

    // Si el producto queda sin stock (y por lo tanto se oculta), no tiene
    // sentido que siga destacado: se lo sacamos también.
    const productoActual = productoEditandoId ? productosCache.find(x => x.id === productoEditandoId) : null;
    const seQuitaDestacadoPorSinStock = todasLasVariantesSinStock && !!productoActual?.destacado;
    if (seQuitaDestacadoPorSinStock) {
        payload.destacado = false;
    }


    // "Nuevo" se marca a mano, pero le ponemos fecha para que no quede pegado
    // para siempre: si se acaba de activar (antes no lo estaba), arrancamos
    // el conteo de 5 días desde ahora. Si ya estaba activo, no tocamos la
    // fecha (para no reiniciar los 5 días en cada edición). Si se desactiva,
    // borramos la fecha.
    const nuevoElegido = document.getElementById('nuevo').checked;
    const productoAnterior = productoEditandoId ? productosCache.find(x => x.id === productoEditandoId) : null;
    const yaEstabaMarcadoNuevo = !!(productoAnterior && productoAnterior.nuevo);

    payload.nuevo = nuevoElegido;
    if (nuevoElegido && !yaEstabaMarcadoNuevo) {
        payload.nuevo_desde = new Date().toISOString();
    } else if (!nuevoElegido) {
        payload.nuevo_desde = null;
    }
    // (si nuevoElegido && yaEstabaMarcadoNuevo: no se incluye nuevo_desde en el
    // payload, así el update no toca la fecha que ya estaba guardada)

    try {
        let productoId = productoEditandoId;

        if (productoId) {
            const { error } = await supabase.from('productos').update(payload).eq('id', productoId);
            if (error) throw error;
        } else {
            const { data, error } = await supabase.from('productos').insert(payload).select().single();
            if (error) throw error;
            productoId = data.id;
        }

        // Borramos en Supabase las variantes que se quitaron en esta edición
        if (variantesEliminadas.length > 0) {
            await supabase.from('variantes').delete().in('id', variantesEliminadas);
        }

        // Sincronizamos variantes: actualizamos las que tienen id, insertamos las nuevas
        for (const v of variantesEnEdicion) {
            if (!v.nombre?.trim() || !v.valor?.trim()) continue; // salteamos filas vacías
            const varPayload = {
                producto_id: productoId,
                nombre: v.nombre.trim(),
                valor: v.valor.trim(),
                precio_adicional: v.precio_adicional ? parsearPrecio(v.precio_adicional) : 0,
                disponible: v.disponible !== false
            };
            if (v.id) {
                await supabase.from('variantes').update(varPayload).eq('id', v.id);
            } else {
                await supabase.from('variantes').insert(varPayload);
            }
        }

        cerrarFormulario();
        await renderProductos();

        if (seOcultoAutomaticamente) {
            mostrarToast(
                seQuitaDestacadoPorSinStock
                    ? 'Producto guardado, pero se ocultó y se quitó de destacados porque todas sus variantes están sin stock.'
                    : 'Producto guardado, pero se ocultó de la tienda porque todas sus variantes están sin stock.',
                'info', 5500);
        } else if (seQuitaDestacadoPorSinStock) {
            mostrarToast('Producto actualizado. Se lo quitó de destacados porque no tiene stock.', 'info', 5500);
        } else {
            mostrarToast(productoEditandoId ? 'Producto actualizado.' : 'Producto creado.', 'success');
        }

    } catch (err) {
        console.error(err);
        mostrarToast('Ocurrió un error guardando el producto.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
    }
});

async function eliminarProducto(id) {
    const confirmado = await confirmarAccion(
        'También se eliminarán sus variantes.',
        { titulo: '¿Eliminar este producto?', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    // Guardamos la imagen antes de borrar la fila, porque después de eliminada
    // ya no vamos a poder consultarla. Comparamos como string porque "id" llega
    // como string (viene del atributo onclick) y en el cache puede ser numérico.
    const producto = productosCache.find(p => String(p.id) === String(id));
    const imagenUrl = producto?.imagen_url;
    const imagenThumbUrl = producto?.imagen_thumb_url;

    const { error } = await supabase.from('productos').delete().eq('id', id);
    if (error) { mostrarToast('No se pudo eliminar el producto.', 'error'); console.error(error); return; }

    // Borramos también la imagen del storage para no dejar archivos huérfanos
    // ocupando espacio. Es silencioso a propósito: si falla, no le suma nada
    // al usuario saberlo (el producto ya se eliminó igual). Ojo: nunca borramos
    // la foto default, porque es compartida por todos los productos sin imagen.
    if (imagenUrl && imagenUrl !== IMAGEN_PRODUCTO_DEFAULT) {
        try {
            await borrarImagenProductoSupabase(imagenUrl, imagenThumbUrl);
        } catch (err) {
            console.error('No se pudo borrar la imagen del producto eliminado:', err);
        }
    }

    mostrarToast('Producto eliminado.', 'success');
    await renderProductos();
}

// Activa/desactiva el producto directamente desde la card, sin pasar por
// el formulario de edición ni recargar toda la grilla. Un producto oculto
// no se ve en el catálogo público ni se puede agregar al carrito (ver
// sincronizarDisponibilidadCarrito en main.js / emprendedor.js).
async function toggleActivoProducto(id, activoActual) {
    const nuevoEstado = !activoActual;
    // Si se oculta el producto (queda sin stock/no disponible) y estaba
    // destacado, le sacamos el destacado: no tiene sentido que algo no
    // disponible siga apareciendo primero en el perfil público.
    const item = productosCache.find(p => String(p.id) === String(id));
    const debeQuitarDestacado = !nuevoEstado && item?.destacado;

    const { error } = await supabase.from('productos')
        .update(debeQuitarDestacado ? { activo: nuevoEstado, destacado: false } : { activo: nuevoEstado })
        .eq('id', id);
    if (error) { mostrarToast('No se pudo actualizar la visibilidad del producto.', 'error'); console.error(error); return; }

    // Actualizamos el estado en memoria y repintamos al toque, sin volver
    // a pedirle la lista completa a Supabase (eso evita el parpadeo/spinner
    // que daba sensación de que la página se recargaba).
    if (item) {
        item.activo = nuevoEstado;
        if (debeQuitarDestacado) item.destacado = false;
    }
    pintarGridProductos();

    if (debeQuitarDestacado) {
        mostrarToast('Producto ocultado y quitado de destacados.', 'info');
    }
}

// Máximo de productos que se pueden marcar como "Destacados": aparecen
// primero en el perfil público, con estrella y borde especial.
const MAX_PRODUCTOS_DESTACADOS = 3;

async function toggleDestacadoProducto(id, destacadoActual) {
    const nuevoEstado = !destacadoActual;

    if (nuevoEstado) {
        const producto = productosCache.find(p => String(p.id) === String(id));
        if (producto && !producto.activo) {
            mostrarToast('No podés destacar un producto sin stock. Reactivalo primero.', 'error');
            return;
        }

        const cantidadActual = productosCache.filter(p => p.destacado).length;
        if (cantidadActual >= MAX_PRODUCTOS_DESTACADOS) {
            mostrarToast(`Ya tenés ${MAX_PRODUCTOS_DESTACADOS} productos destacados. Sacá uno para agregar otro.`, 'error');
            return;
        }
    }

    const { error } = await supabase.from('productos').update({ destacado: nuevoEstado }).eq('id', id);
    if (error) { mostrarToast('No se pudo actualizar el producto.', 'error'); console.error(error); return; }

    const item = productosCache.find(p => String(p.id) === String(id));
    if (item) item.destacado = nuevoEstado;
    pintarGridProductos();

    mostrarToast(nuevoEstado ? 'Producto marcado como destacado.' : 'Producto quitado de destacados.', 'success');
}

// ============================================================
// PERFIL DEL EMPRENDEDOR
// ============================================================
async function cargarPerfilEmprendedor() {
    let { data, error } = await supabase
        .from('emprendedores')
        .select('*')
        .eq('id', perfilActual.id)
        .single();

    // Si la cuenta se creó a mano (auth + fila en "usuarios") todavía no existe
    // la fila en "emprendedores" -> la creamos vacía la primera vez que entra.
    if (error && error.code === 'PGRST116') {
        const { data: nuevo, error: errorInsert } = await supabase
            .from('emprendedores')
            .insert({ id: perfilActual.id, nombre_tienda: perfilActual.usuario, activo: true })
            .select()
            .single();
        if (errorInsert) { console.error(errorInsert); return; }
        data = nuevo;
    } else if (error) {
        console.error(error);
        return;
    }

    emprendedorActual = data;
    actualizarBannerBloqueo(emprendedorActual);
    renderEstadoSuscripcion(emprendedorActual);
    evaluarAccesoYAvisar(emprendedorActual);

    document.getElementById('p-nombre').value = data.nombre_tienda || '';
    document.getElementById('p-whatsapp').value = (data.whatsapp || '').replace(/^549/, '');
    document.getElementById('p-logo').value = data.logo_url || '';
    document.getElementById('p-banner').value = data.banner_url || '';
    document.getElementById('p-bio').value = data.bio || '';
    document.getElementById('p-ubicacion').value = data.ubicacion || '';
    document.getElementById('p-mapa').value = data.mapa_url || '';
    document.getElementById('p-horario').value = data.horario_atencion || '';
    document.getElementById('p-instagram').value = extraerUsuarioRedSocial(data.instagram || '');
    document.getElementById('p-facebook').value = data.facebook || '';
    document.getElementById('p-tiktok').value = extraerUsuarioRedSocial(data.tiktok || '');
    document.getElementById('p-costo-envio').value = data.costo_envio ? formatoPrecioInput(data.costo_envio) : '';
    document.getElementById('p-anuncio').value = data.anuncio || '';
    const chkPedidos = document.getElementById('p-recibe-pedidos');
    if (chkPedidos) chkPedidos.checked = data.recibe_pedidos === true;

    mediosPagoPerfilSeleccion = data.medios_pago || [];
    renderMediosPagoPerfil();
    actualizarTarjetaCuentaSidebar(data.nombre_tienda, data.logo_url);
    actualizarPreviewLogo(data.logo_url);
    actualizarPreviewBanner(data.banner_url);
    actualizarContadorAnuncio();
    ajustarTextareasAutogrow();
    inicioCargado.perfil = true;
    renderInicio();
}

// ============================================================
// SUBIDA DE IMAGEN — LOGO Y BANNER (Cloudinary)
// ============================================================
async function manejarSeleccionLogo(event) {
    const file = event.target.files[0];
    if (!file) return;

    const errorValidacion = validarImagenSeleccionada(file);
    if (errorValidacion) {
        mostrarToast(errorValidacion, 'error');
        event.target.value = '';
        return;
    }

    mostrarSpinnerImagen('p-logo', true);
    try {
        const url = await subirImagenCloudinary(file, 800);
        document.getElementById('p-logo').value = url;
        actualizarPreviewLogo(url);
        actualizarTarjetaCuentaSidebar(document.getElementById('p-nombre').value, url);
    } catch (err) {
        console.error(err);
        mostrarToast('No se pudo subir el logo. Probá de nuevo.', 'error');
    } finally {
        mostrarSpinnerImagen('p-logo', false);
        event.target.value = '';
    }
}

async function manejarSeleccionBanner(event) {
    const file = event.target.files[0];
    if (!file) return;

    const errorValidacion = validarImagenSeleccionada(file);
    if (errorValidacion) {
        mostrarToast(errorValidacion, 'error');
        event.target.value = '';
        return;
    }

    mostrarSpinnerImagen('p-banner', true);
    try {
        const url = await subirImagenCloudinary(file, 1600);
        document.getElementById('p-banner').value = url;
        actualizarPreviewBanner(url);
    } catch (err) {
        console.error(err);
        mostrarToast('No se pudo subir el banner. Probá de nuevo.', 'error');
    } finally {
        mostrarSpinnerImagen('p-banner', false);
        event.target.value = '';
    }
}

// Muestra la preview del banner (o el placeholder si está vacío/URL inválida)
function actualizarPreviewBanner(url) {
    const img = document.getElementById('p-banner-preview');
    const placeholder = document.getElementById('p-banner-preview-placeholder');
    const valor = (url || '').trim();

    if (!valor) {
        img.classList.add('hidden');
        img.src = '';
        placeholder.classList.remove('hidden');
        return;
    }

    img.onerror = () => {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    };
    img.onload = () => {
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
    };
    img.src = valor;
}

// Muestra la preview de la imagen del logo (o el placeholder si está vacío/URL inválida)
function actualizarPreviewLogo(url) {
    const img = document.getElementById('p-logo-preview');
    const placeholder = document.getElementById('p-logo-preview-placeholder');
    const valor = (url || '').trim();

    if (!valor) {
        img.classList.add('hidden');
        img.src = '';
        placeholder.classList.remove('hidden');
        return;
    }

    img.onerror = () => {
        img.classList.add('hidden');
        placeholder.classList.remove('hidden');
    };
    img.onload = () => {
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
    };
    img.src = valor;
}

// Refleja el nombre de la tienda (o el usuario si todavía no lo cargó) y el logo
// en la tarjeta de cuenta del sidebar. Si no hay logo (o la URL falla), muestra
// la letra inicial como respaldo.
function actualizarTarjetaCuentaSidebar(nombreTienda, logoUrl) {
    const nombre = (nombreTienda || '').trim() || perfilActual.usuario;
    document.getElementById('nombre-tienda-sidebar').textContent = nombre;

    const letra = document.getElementById('avatar-sidebar-letra');
    const img = document.getElementById('avatar-sidebar-img');
    letra.textContent = nombre.charAt(0).toUpperCase();

    const url = (logoUrl || '').trim();
    if (!url) {
        img.classList.add('hidden');
        img.src = '';
        letra.classList.remove('hidden');
        return;
    }

    img.onload = () => {
        img.classList.remove('hidden');
        letra.classList.add('hidden');
    };
    img.onerror = () => {
        img.classList.add('hidden');
        letra.classList.remove('hidden');
    };
    img.src = url;
}

async function guardarPerfil() {
    const btn = document.getElementById('btn-guardar-perfil-2');
    const textoOriginal = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const datos = {
        nombre_tienda: document.getElementById('p-nombre').value.trim(),
        whatsapp: (() => {
            const num = document.getElementById('p-whatsapp').value.trim().replace(/\D/g, '');
            if (!num) return '';
            return num.startsWith('549') ? num : '549' + num;
        })(),
        logo_url: document.getElementById('p-logo').value.trim(),
        banner_url: document.getElementById('p-banner').value.trim(),
        bio: document.getElementById('p-bio').value.trim(),
        ubicacion: document.getElementById('p-ubicacion').value.trim(),
        mapa_url: document.getElementById('p-mapa').value.trim(),
        horario_atencion: document.getElementById('p-horario').value.trim(),
        instagram: (() => {
            const usuario = extraerUsuarioRedSocial(document.getElementById('p-instagram').value);
            return usuario ? `https://instagram.com/${usuario}` : '';
        })(),
        facebook: document.getElementById('p-facebook').value.trim(),
        tiktok: (() => {
            const usuario = extraerUsuarioRedSocial(document.getElementById('p-tiktok').value);
            return usuario ? `https://tiktok.com/@${usuario}` : '';
        })(),
        medios_pago: mediosPagoPerfilSeleccion,
        costo_envio: parsearPrecio(document.getElementById('p-costo-envio').value),
        recibe_pedidos: !!document.getElementById('p-recibe-pedidos')?.checked
    };

    const { error } = await supabase.from('emprendedores').update(datos).eq('id', perfilActual.id);

    if (error) {
        console.error(error);
        btn.innerText = 'Error al guardar ✕';
        btn.classList.replace('bg-obsidian', 'bg-red-500');
    } else {
        if (emprendedorActual) {
            Object.assign(emprendedorActual, datos);
            emprendedorActual.medios_pago = mediosPagoPerfilSeleccion;
            emprendedorActual.costo_envio = datos.costo_envio;
        }
        actualizarTarjetaCuentaSidebar(datos.nombre_tienda, datos.logo_url);
        renderInicio();
        btn.innerText = '¡PERFIL ACTUALIZADO! ✓';
        btn.classList.replace('bg-obsidian', 'bg-green-500');
    }

    setTimeout(() => {
        btn.innerText = textoOriginal;
        btn.classList.remove('bg-green-500', 'bg-red-500');
        btn.classList.add('bg-obsidian');
        btn.disabled = false;
    }, 2000);
}

// ============================================================
// ANUNCIOS (barra temporal arriba del perfil público)
// ============================================================
function actualizarContadorAnuncio() {
    const texto = document.getElementById('p-anuncio').value;
    document.getElementById('contador-anuncio').textContent = texto.length;

    const previewTexto = texto.trim();
    document.getElementById('preview-anuncio-texto').textContent = previewTexto;
    document.getElementById('preview-anuncio-wrap').classList.toggle('hidden', !previewTexto);
    document.getElementById('preview-anuncio-wrap').classList.toggle('flex', !!previewTexto);
    document.getElementById('preview-anuncio-vacio').classList.toggle('hidden', !!previewTexto);
}

async function guardarAnuncio() {
    const btn = document.getElementById('btn-guardar-anuncio');
    const textoOriginal = btn.innerText;
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    const anuncio = document.getElementById('p-anuncio').value.trim();

    const { error } = await supabase.from('emprendedores').update({ anuncio }).eq('id', perfilActual.id);

    if (error) {
        console.error(error);
        btn.innerText = 'Error al guardar ✕';
        btn.classList.replace('bg-obsidian', 'bg-red-500');
    } else {
        if (emprendedorActual) emprendedorActual.anuncio = anuncio;
        renderInicio();
        document.getElementById('p-anuncio').value = anuncio;
        actualizarContadorAnuncio();
        btn.innerText = anuncio ? '¡ANUNCIO PUBLICADO! ✓' : '¡ANUNCIO GUARDADO! ✓';
        btn.classList.replace('bg-obsidian', 'bg-green-500');
    }

    setTimeout(() => {
        btn.innerText = textoOriginal;
        btn.classList.remove('bg-green-500', 'bg-red-500');
        btn.classList.add('bg-obsidian');
        btn.disabled = false;
    }, 2000);
}

async function quitarAnuncio() {
    const actual = document.getElementById('p-anuncio').value.trim();
    if (!actual) {
        mostrarToast('No tenés ningún anuncio activo.', 'info');
        return;
    }
    const ok = await confirmarAccion('Se va a dejar de mostrar la barra de anuncio en tu perfil.', {
        titulo: '¿Quitar el anuncio?',
        textoConfirmar: 'Quitar',
        peligro: true,
    });
    if (!ok) return;

    document.getElementById('p-anuncio').value = '';
    ajustarTextareasAutogrow();
    await guardarAnuncio();
}

// ============================================================
// SUSCRIPCIÓN (MercadoPago)
// ============================================================

// Pinta la tarjeta de "Suscripción" en section-soporte según el
// estado guardado en la fila de emprendedores.
function renderEstadoSuscripcion(data) {
    const cargando = document.getElementById('susc-cargando');
    const contenido = document.getElementById('susc-contenido');
    const label = document.getElementById('susc-estado-label');
    const vencimientoEl = document.getElementById('susc-vencimiento');
    const badge = document.getElementById('susc-badge');
    const btnPagar = document.getElementById('susc-btn-pagar');

    if (!cargando) return;

    cargando.classList.add('hidden');
    contenido.classList.remove('hidden');

    // calcularEstadoAcceso() ya sabe distinguir el mes gratis real de lo
    // que diga "suscripcion_estado" en la base (esa columna puede traer
    // 'vencida' u otro valor que no corresponde todavía a una cuenta que
    // nunca generó una suscripción paga en MercadoPago). Usamos el mismo
    // criterio acá para que el cartel no contradiga al resto del panel.
    const acceso = calcularEstadoAcceso(data);

    let estado = acceso.enPruebaGratis
        ? 'prueba_gratis'
        : (data.suscripcion_estado || 'sin_suscripcion');

    // Pagó antes pero ya pasó la fecha de vencimiento: se muestra como vencida
    // (con botón para volver a pagar) en vez de "Suscripción activa".
    if (estado === 'authorized' && acceso.bloqueado && acceso.motivo === 'pago') estado = 'vencida';

    const vencimiento = acceso.enPruebaGratis
        ? acceso.vencimiento
        : (data.fecha_vencimiento_suscripcion ? new Date(data.fecha_vencimiento_suscripcion) : null);

    // Días que quedan de mes gratis / margen de membresía (0 si ya venció o no aplica)
    const diasRestantesPrueba = ((estado === 'prueba_gratis' || estado === 'membresia_al_dia') && vencimiento)
        ? Math.max(0, Math.ceil((vencimiento.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
        : 0;

    const ESTADOS = {
        sin_suscripcion: { texto: 'Todavía no activaste tu suscripción', color: 'bg-slate-100 text-slate-500', badge: 'Sin activar', mostrarBoton: true },
        prueba_gratis: {
            texto: diasRestantesPrueba > 0
                ? `Estás en tu mes gratis · te ${diasRestantesPrueba === 1 ? 'queda 1 día' : `quedan ${diasRestantesPrueba} días`}`
                : 'Tu mes gratis ya terminó',
            color: 'bg-blue-100 text-blue-700', badge: 'Mes gratis', mostrarBoton: true,
        },
        membresia_al_dia: {
            texto: diasRestantesPrueba > 0
                ? 'Tu membresía está al día'
                : 'Tu membresía vencida, renovala para seguir activa',
            color: diasRestantesPrueba > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700',
            badge: diasRestantesPrueba > 0 ? 'Activa' : 'Vencida',
            mostrarBoton: diasRestantesPrueba === 0,
        },
        pending: { texto: 'Autorización de pago pendiente', color: 'bg-amber-100 text-amber-700', badge: 'Pendiente', mostrarBoton: true },
        authorized: { texto: 'Suscripción activa', color: 'bg-emerald-100 text-emerald-700', badge: 'Activa', mostrarBoton: false },
        pago_rechazado: { texto: 'El último cobro fue rechazado', color: 'bg-red-100 text-red-700', badge: 'Pago rechazado', mostrarBoton: true },
        vencida: { texto: 'Suscripción vencida', color: 'bg-red-100 text-red-700', badge: 'Vencida', mostrarBoton: true },
        cancelled: { texto: 'Suscripción cancelada', color: 'bg-red-100 text-red-700', badge: 'Cancelada', mostrarBoton: true },
        paused: { texto: 'Suscripción pausada', color: 'bg-amber-100 text-amber-700', badge: 'Pausada', mostrarBoton: true },
    };

    const info = ESTADOS[estado] || ESTADOS.sin_suscripcion;

    label.textContent = info.texto;
    badge.textContent = info.badge;
    badge.className = 'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide ' + info.color;

    vencimientoEl.textContent = vencimiento
        ? (estado === 'authorized' ? 'Próximo cobro: '
            : estado === 'prueba_gratis'
                ? (diasRestantesPrueba > 0 ? 'Próximo cobro: ' : 'Tu mes gratis venció el: ')
            : estado === 'membresia_al_dia'
                ? (diasRestantesPrueba > 0 ? 'Próximo pago: ' : 'Tu membresía venció el: ')
            : 'Venció el: ') + vencimiento.toLocaleDateString('es-AR')
        : '';

    btnPagar.classList.toggle('hidden', !info.mostrarBoton);

    // Mientras dura el mes gratis, el botón queda visible pero oscurecido
    // y sin funcionar: no tiene sentido cobrar antes de que termine el
    // período gratuito. Se reactiva solo (mismo render) apenas
    // diasRestantesPrueba llega a 0.
    const hint = document.getElementById('susc-btn-pagar-hint');
    // Para 'membresia_al_dia' el botón ya está oculto por mostrarBoton, así
    // que este hint (pensado para el botón visible-pero-deshabilitado del
    // mes gratis de emprendedores) sólo aplica a 'prueba_gratis'.
    const enMesGratisVigente = estado === 'prueba_gratis' && diasRestantesPrueba > 0;

    btnPagar.disabled = enMesGratisVigente;
    btnPagar.setAttribute('aria-disabled', String(enMesGratisVigente));

    if (hint) {
        hint.classList.toggle('hidden', !enMesGratisVigente);
        hint.textContent = enMesGratisVigente
            ? `Vas a poder pagar cuando termine tu mes gratis (en ${diasRestantesPrueba === 1 ? '1 día' : diasRestantesPrueba + ' días'}).`
            : '';
    }
}

// ------------------------------------------------------------
// Pago de la suscripción con Card Payment Brick (embebido, sin
// redirigir a mercadopago.com ni abrir la app en mobile).
// ------------------------------------------------------------
let mpInstancia = null;       // instancia del SDK de MercadoPago (se crea una sola vez)
let brickTarjetaControlador = null; // controlador del brick montado actualmente, para poder desmontarlo

// Skeleton que se ve mientras carga el Brick; se restaura acá porque en el
// flujo de error más abajo ese mismo contenedor se reemplaza por un mensaje
// de texto plano, y hay que dejarlo listo para la próxima vez que se abra.
const ESQUELETO_CARGANDO_PAGO = `
    <div class="mps-skeleton-row" style="width:100%"></div>
    <div class="mps-skeleton-row" style="width:72%"></div>
    <div class="mps-skeleton-row" style="width:88%"></div>
    <div class="mps-skeleton-row" style="width:55%"></div>
`;

async function abrirModalPagoSuscripcion() {
    const modal = document.getElementById('modal-pago-suscripcion');
    const cargando = document.getElementById('modal-pago-cargando');
    const contenedorBrick = document.getElementById('brick-tarjeta');
    const montoEl = document.getElementById('modal-pago-monto');

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    cargando.classList.remove('hidden');
    cargando.innerHTML = ESQUELETO_CARGANDO_PAGO;
    contenedorBrick.classList.add('hidden');
    contenedorBrick.innerHTML = '';
    ajustarModalPagoAlViewportVisible();

    try {
        // 1) Traemos public key + precio vigente desde el Worker.
        const resConfig = await fetch(`${WORKER_SUSCRIPCIONES_URL}/config-pago?emprendedor_id=${encodeURIComponent(perfilActual.id)}`);
        const config = await resConfig.json();
        if (!resConfig.ok || !config.publicKey) {
            throw new Error(config.error || 'No se pudo cargar la configuración de pago');
        }

        montoEl.textContent = formatoPrecio(config.precio);

        // 2) Inicializamos el SDK una sola vez
        if (!mpInstancia) {
            mpInstancia = new MercadoPago(config.publicKey, { locale: 'es-AR' });
        }

        // 3) Si ya había un brick montado (el emprendedor cerró y volvió a
        //    abrir el modal), lo desmontamos antes de crear uno nuevo.
        if (brickTarjetaControlador) {
            await brickTarjetaControlador.unmount();
            brickTarjetaControlador = null;
        }

        // Si le pasamos el email al Brick, NO muestra el campo de e-mail.
        // Sale de la cuenta con la que inició sesión (Supabase Auth).
        const sesionPago = await obtenerSesion();
        const emailPagador = sesionPago?.user?.email || perfilActual?.email || undefined;

        brickTarjetaControlador = await mpInstancia.bricks().create('cardPayment', 'brick-tarjeta', {
            initialization: {
                amount: config.precio,
                payer: emailPagador ? { email: emailPagador } : undefined,
            },
            customization: {
                visual: {
                    style: {
                        // Sin theme ni customVariables: usamos el diseño "default"
                        // del Brick tal cual, que ya viene con su propio layout
                        // responsive (sabe cuándo poner vencimiento/CVV en una
                        // fila o dos según el ancho disponible, tamaños de fuente
                        // que no disparan el auto-zoom de iOS, etc). La versión
                        // anterior forzaba padding y tamaños de fuente que
                        // rompían ese layout interno (labels que se cortaban en
                        // dos líneas, campos desalineados). Si más adelante hace
                        // falta acercar el look al resto del panel, es mejor ir
                        // agregando UNA variable a la vez desde acá y probando en
                        // un celular real, en vez de reconstruir todo el set.
                        customVariables: {
                            baseColor: '#0b0c10',
                        },
                    },
                },
            },
            callbacks: {
                onReady: () => {
                    cargando.classList.add('hidden');
                    contenedorBrick.classList.remove('hidden');
                },
                onError: (error) => {
                    console.error('Error del Card Payment Brick:', error);
                },
                onSubmit: (cardFormData) => {
                    return enviarPagoSuscripcion(cardFormData);
                },
            },
        });
    } catch (err) {
        console.error(err);
        cargando.textContent = 'No pudimos cargar el formulario de pago. Cerrá esta ventana y probá de nuevo.';
        mostrarToast('No pudimos iniciar el pago. Probá de nuevo en un momento.', 'error');
    }
}

// Manda el token de la tarjeta (generado por el Brick, nunca el número
// de tarjeta en sí) al Worker, que crea el pago contra la API de MP.
async function enviarPagoSuscripcion(cardFormData) {
    try {
        const res = await fetch(`${WORKER_SUSCRIPCIONES_URL}/procesar-pago-suscripcion`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                emprendedor_id: perfilActual.id,
                token: cardFormData.token,
                payment_method_id: cardFormData.payment_method_id,
                issuer_id: cardFormData.issuer_id,
                installments: cardFormData.installments,
                payer: cardFormData.payer,
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error((data.error || 'No se pudo procesar el pago') + (data.detalle ? ' — ' + JSON.stringify(data.detalle) : ''));
        }

        if (data.status === 'approved') {
            cerrarModalPagoSuscripcion();
            abrirModalPagoExitoso();
            await cargarPerfilEmprendedor();
        } else if (data.status === 'in_process' || data.status === 'pending') {
            mostrarToast('Tu pago quedó en revisión. Te avisamos apenas se acredite.', 'info');
            cerrarModalPagoSuscripcion();
        } else {
            mostrarToast(mensajeRechazoPago(data.status_detail), 'error');
        }
    } catch (err) {
        console.error(err);
        mostrarToast('No pudimos procesar el pago. Probá de nuevo o con otra tarjeta.', 'error');
        // Re-lanzamos para que el Brick sepa que falló y no bloquee el botón.
        throw err;
    }
}

// Traduce los motivos de rechazo más comunes de MercadoPago a un mensaje entendible.
function mensajeRechazoPago(statusDetail) {
    const MENSAJES = {
        cc_rejected_insufficient_amount: 'Fondos insuficientes en la tarjeta.',
        cc_rejected_bad_filled_card_number: 'Revisá el número de tarjeta.',
        cc_rejected_bad_filled_date: 'Revisá la fecha de vencimiento.',
        cc_rejected_bad_filled_security_code: 'Revisá el código de seguridad.',
        cc_rejected_bad_filled_other: 'Revisá los datos de la tarjeta.',
        cc_rejected_card_disabled: 'Llamá a tu banco para activar la tarjeta.',
        cc_rejected_call_for_authorize: 'Tenés que autorizar el pago con tu banco.',
        cc_rejected_duplicated_payment: 'Ya hiciste un pago por ese monto, esperá unos minutos.',
        cc_rejected_high_risk: 'El pago fue rechazado por seguridad. Probá con otro medio de pago.',
        cc_rejected_max_attempts: 'Llegaste al límite de intentos permitidos.',
        cc_rejected_other_reason: 'Tu banco rechazó el pago. Probá con otra tarjeta.',
    };
    return MENSAJES[statusDetail] || 'El pago fue rechazado. Probá de nuevo o con otra tarjeta.';
}

function cerrarModalPagoSuscripcion() {
    const modal = document.getElementById('modal-pago-suscripcion');
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (brickTarjetaControlador) {
        brickTarjetaControlador.unmount();
        brickTarjetaControlador = null;
    }
}

// Modal de confirmación tras un pago aprobado. Simple: no depende del
// visualViewport porque no tiene campos de formulario ni teclado que
// gestionar, así que no necesita el mismo tratamiento que los otros dos.
function abrirModalPagoExitoso() {
    document.getElementById('modal-pago-exitoso').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}
function cerrarModalPagoExitoso() {
    document.getElementById('modal-pago-exitoso').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

// ============================================================
// TECLADO VIRTUAL EN MOBILE (modal de pago) — mismo criterio que
// ajustarModalAlViewportVisible() para el modal de producto: en
// Android el layout viewport no se achica cuando aparece el teclado,
// así que usamos la Visual Viewport API para conocer el alto
// realmente visible y achicar el modal a ese tamaño en tiempo real.
// Variable propia (--app-height-pago) para no pisar la del otro modal.
// ============================================================
let _rafModalPago = null;
function ajustarModalPagoAlViewportVisible() {
    const modalPago = document.getElementById('modal-pago-suscripcion');
    if (!window.visualViewport || !modalPago || modalPago.classList.contains('hidden')) return;
    // Mismo throttle que en ajustarModalAlViewportVisible: evita recalcular
    // el layout en cada micro-evento durante la animación del teclado.
    if (_rafModalPago) return;
    _rafModalPago = requestAnimationFrame(() => {
        _rafModalPago = null;
        const vv = window.visualViewport;
        document.documentElement.style.setProperty('--app-height-pago', vv.height + 'px');
        modalPago.style.top = vv.offsetTop + 'px';
    });
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustarModalPagoAlViewportVisible);
    window.visualViewport.addEventListener('scroll', ajustarModalPagoAlViewportVisible);
}

// ------------------------------------------------------------
// Los campos del Card Payment Brick (número de tarjeta, vencimiento,
// CVV) viven dentro de un <iframe> propio de MercadoPago por motivos
// de PCI-DSS: nuestra página nunca toca esos datos. Por eso NO podemos
// escuchar "focus"/"focusin" en esos campos como sí hacemos con
// centrarCampo() en el modal de producto — un iframe cross-origin no
// expone esos eventos al documento padre.
//
// Lo que SÍ es detectable desde afuera: cuando el foco entra a un
// iframe, la ventana principal recibe un evento "blur" y
// document.activeElement pasa a ser ese <iframe>. Usamos eso como
// proxy para, en ese momento, asegurar que el contenedor del Brick
// quede visible dentro del sheet — así el header ("Pagar suscripción")
// no queda tapado cuando el teclado se abre.
window.addEventListener('blur', () => {
    const modalPago = document.getElementById('modal-pago-suscripcion');
    if (!modalPago || modalPago.classList.contains('hidden')) return;
    if (document.activeElement && document.activeElement.tagName === 'IFRAME') {
        requestAnimationFrame(() => {
            const contenedorBrick = document.getElementById('brick-tarjeta');
            if (contenedorBrick) {
                contenedorBrick.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }
});


// ============================================================
// CATEGORÍAS DE MI TIENDA
// Propias de cada negocio y con subniveles (hasta 3):
//   Categoría > Subcategoría > Sub-subcategoría
// Tabla: categorias_tienda (ver categorias_tienda.sql).
// Cada producto guarda en categoria_tienda_id la más específica.
// ============================================================
const MAX_NIVELES_CATEGORIA = 3;
let categoriasTienda = [];            // filas de categorias_tienda de este comercio
let categoriaTiendaEditandoId = null; // fila que se está renombrando
let errorCategoriasTienda = false;

async function cargarCategoriasTienda() {
    const { data, error } = await supabase
        .from('categorias_tienda')
        .select('*')
        .eq('emprendedor_id', perfilActual.id)
        .order('orden')
        .order('nombre');
    if (error) {
        console.error('Error cargando categorías de la tienda:', error);
        errorCategoriasTienda = true;
        categoriasTienda = [];
    } else {
        errorCategoriasTienda = false;
        categoriasTienda = data || [];
    }
    inicioCargado.categorias = true;
    renderCategoriasTienda();
    renderInicio();
    poblarSelectsCategoriaTienda();
    // Las tarjetas de "Mis productos" muestran el nombre de la categoría: se repintan
    // si ya había productos cargados (renombrar/borrar una categoría se refleja al instante).
    if (productosCache.length) pintarGridProductos();
}

// Árbol en orden de lectura: [{ c, depth, ruta:[nombres], hermanos:[filas] }]
function aplanarCategoriasTienda() {
    const hijos = new Map();
    categoriasTienda.forEach(c => {
        const k = c.parent_id == null ? 'root' : c.parent_id;
        if (!hijos.has(k)) hijos.set(k, []);
        hijos.get(k).push(c);
    });
    hijos.forEach(l => l.sort((a, b) => ((a.orden || 0) - (b.orden || 0)) || a.nombre.localeCompare(b.nombre, 'es')));
    const salida = [];
    const recorrer = (k, depth, ruta) => {
        (hijos.get(k) || []).forEach(c => {
            const r = [...ruta, c.nombre];
            salida.push({ c, depth, ruta: r, hermanos: hijos.get(k) });
            recorrer(c.id, depth + 1, r);
        });
    };
    recorrer('root', 0, []);
    return salida;
}

// ids de una categoría y todas sus descendientes
function idsSubarbolCategoriaTienda(id) {
    const ids = new Set([id]);
    let cambio = true;
    while (cambio) {
        cambio = false;
        categoriasTienda.forEach(c => {
            if (c.parent_id != null && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); cambio = true; }
        });
    }
    return ids;
}

// Nombre de la categoría de la tienda de un producto (para la tarjeta de "Mis productos")
function nombreCategoriaDeProducto(p) {
    const c = p.categoria_tienda_id != null ? categoriasTienda.find(x => x.id === p.categoria_tienda_id) : null;
    return c ? c.nombre : 'Sin categoría';
}

function contarProductosCategoriaTienda(id) {
    const ids = idsSubarbolCategoriaTienda(id);
    return productosCache.filter(p => p.categoria_tienda_id != null && ids.has(p.categoria_tienda_id)).length;
}

function poblarSelectsCategoriaTienda() {
    const arbol = aplanarCategoriasTienda();

    // Select del formulario de producto
    const sel = document.getElementById('categoria-tienda');
    if (sel) {
        const actual = sel.value;
        sel.replaceChildren(new Option('Sin categoría', ''));
        arbol.forEach(({ c, ruta }) => sel.appendChild(new Option(ruta.join(' › '), String(c.id))));
        if (actual && arbol.some(({ c }) => String(c.id) === actual)) sel.value = actual;
        const hint = document.getElementById('hint-categoria-tienda');
        if (hint) hint.textContent = arbol.length
            ? 'Opcional. Elegí la más específica y el producto aparece también dentro de las categorías que la contienen.'
            : 'Opcional. Todavía no creaste categorías: armalas en «Mis categorías» (menú de la izquierda).';
    }

    // Select del filtro de "Mis productos" (conserva la selección si todavía existe)
    const filtro = document.getElementById('filtro-categoria-productos');
    if (filtro) {
        const actual = filtro.value;
        filtro.replaceChildren(new Option('Todas las categorías', ''));
        arbol.forEach(({ c, ruta }) => filtro.appendChild(new Option(ruta.join(' › '), String(c.id))));
        if (actual && arbol.some(({ c }) => String(c.id) === actual)) {
            filtro.value = actual;
        } else {
            filtro.value = '';
            filtroCategoriaProductos = '';
        }
    }

    // Select "dónde va" del alta (solo hasta el nivel anterior al máximo)
    const padre = document.getElementById('cat-nueva-padre');
    if (padre) {
        const actual = padre.value;
        padre.replaceChildren(new Option('Categoría principal', ''));
        arbol.filter(({ depth }) => depth < MAX_NIVELES_CATEGORIA - 1)
            .forEach(({ c, ruta }) => padre.appendChild(new Option('Dentro de: ' + ruta.join(' › '), String(c.id))));
        if (actual && [...padre.options].some(o => o.value === actual)) padre.value = actual;
    }
}

function renderCategoriasTienda() {
    const cont = document.getElementById('lista-categorias-tienda');
    if (!cont) return;
    cont.replaceChildren();

    const mk = (tag, clase, texto) => {
        const n = document.createElement(tag);
        if (clase) n.className = clase;
        if (texto !== undefined) n.textContent = texto;
        return n;
    };

    if (errorCategoriasTienda) {
        cont.appendChild(mk('p', 'text-center text-red-400 font-semibold py-16 px-4', 'No pudimos cargar las categorías. Revisá que la tabla categorias_tienda esté creada en Supabase.'));
        return;
    }

    const arbol = aplanarCategoriasTienda();
    if (!arbol.length) {
        const vacio = mk('div', 'text-center py-14 px-6');
        vacio.appendChild(mk('p', 'text-slate-700 font-extrabold text-lg', 'Todavía no creaste categorías'));
        vacio.appendChild(mk('p', 'text-slate-400 text-sm font-medium mt-2 max-w-md mx-auto', 'Empezá por las secciones principales de tu tienda. Después podés sumar subcategorías dentro de cada una.'));
        cont.appendChild(vacio);
        return;
    }

    const svg = (d) => `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${d}"/></svg>`;
    const btnIcono = (html, titulo, onclick, deshabilitado) => {
        const b = mk('button', 'w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-25 disabled:pointer-events-none flex-shrink-0');
        b.type = 'button';
        b.innerHTML = html;
        b.title = titulo;
        b.setAttribute('aria-label', titulo);
        b.disabled = !!deshabilitado;
        b.onclick = onclick;
        return b;
    };

    arbol.forEach(({ c, depth, hermanos }) => {
        // En mobile la fila se parte en dos renglones (nombre completo arriba; cantidad y
        // acciones abajo) para que el nombre no se corte. Desde sm va todo en una sola línea.
        const fila = mk('div', 'cat-fila flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-1.5 py-3 sm:py-2.5 pr-2 sm:pr-3');
        fila.style.setProperty('--nivel', String(depth));

        if (categoriaTiendaEditandoId === c.id) {
            const input = mk('input', 'basis-full sm:basis-0 sm:flex-1 min-w-0 bg-white border border-obsidian rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm font-semibold outline-none ring-4 ring-yellow-400/20');
            input.type = 'text';
            input.maxLength = 40;
            input.value = c.nombre;
            input.onkeydown = (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); guardarNombreCategoriaTienda(c.id, input.value); }
                if (ev.key === 'Escape') { categoriaTiendaEditandoId = null; renderCategoriasTienda(); }
            };
            const ok = mk('button', 'flex-1 sm:flex-none px-3 py-2.5 sm:py-2 rounded-lg bg-obsidian text-white text-xs font-bold hover:bg-yellow-400 hover:text-black transition-colors', 'Guardar');
            ok.type = 'button';
            ok.onclick = () => guardarNombreCategoriaTienda(c.id, input.value);
            const cancel = mk('button', 'flex-1 sm:flex-none px-3 py-2.5 sm:py-2 rounded-lg text-slate-500 text-xs font-bold hover:bg-slate-100 transition-colors', 'Cancelar');
            cancel.type = 'button';
            cancel.onclick = () => { categoriaTiendaEditandoId = null; renderCategoriasTienda(); };
            fila.append(input, ok, cancel);
            cont.appendChild(fila);
            setTimeout(() => { input.focus(); input.select(); }, 0);
            return;
        }

        // Nombre: en mobile ocupa todo el ancho y puede ocupar varias líneas; desde sm se corta con "…".
        const bloqueNombre = mk('div', 'flex items-start sm:items-center gap-1.5 min-w-0 basis-full sm:basis-auto');
        if (depth > 0) bloqueNombre.appendChild(mk('span', 'text-slate-300 font-bold flex-shrink-0', '↳'));
        const nombre = mk('span', (depth === 0 ? 'font-extrabold text-slate-900' : 'font-bold text-slate-700') + ' text-[15px] leading-snug break-words min-w-0 sm:truncate');
        nombre.textContent = c.nombre;
        nombre.title = c.nombre;
        bloqueNombre.appendChild(nombre);
        fila.appendChild(bloqueNombre);

        const n = contarProductosCategoriaTienda(c.id);
        fila.appendChild(mk('span', 'text-[11px] font-bold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 flex-shrink-0 whitespace-nowrap', `${n} producto${n === 1 ? '' : 's'}`));
        fila.appendChild(mk('span', 'flex-1'));

        const idx = hermanos.findIndex(h => h.id === c.id);
        fila.appendChild(btnIcono(svg('M5 15l7-7 7 7'), 'Subir', () => moverCategoriaTienda(c.id, -1), idx === 0));
        fila.appendChild(btnIcono(svg('M19 9l-7 7-7-7'), 'Bajar', () => moverCategoriaTienda(c.id, 1), idx === hermanos.length - 1));
        if (depth < MAX_NIVELES_CATEGORIA - 1) {
            fila.appendChild(btnIcono(svg('M12 5v14M5 12h14'), 'Agregar subcategoría', () => prepararSubcategoria(c.id)));
        }
        fila.appendChild(btnIcono(svg('M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2.5 2.5 0 113.536 3.536L12.5 16.5 8 18l1-4.5z'), 'Cambiar nombre', () => { categoriaTiendaEditandoId = c.id; renderCategoriasTienda(); }));
        const del = btnIcono(svg('M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16'), 'Eliminar', () => eliminarCategoriaTienda(c.id));
        del.classList.add('hover:!bg-red-50', 'hover:!text-red-600');
        fila.appendChild(del);

        cont.appendChild(fila);
    });
}

function prepararSubcategoria(id) {
    const padre = document.getElementById('cat-nueva-padre');
    const input = document.getElementById('cat-nueva-nombre');
    if (padre) padre.value = String(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => input && input.focus(), 250);
}

function categoriaTiendaDuplicada(nombre, padreId, ignorarId) {
    const buscado = nombre.trim().toLowerCase();
    return categoriasTienda.some(c =>
        (c.parent_id ?? null) === (padreId ?? null) && c.id !== ignorarId && c.nombre.trim().toLowerCase() === buscado);
}

async function agregarCategoriasTienda() {
    const input = document.getElementById('cat-nueva-nombre');
    const selPadre = document.getElementById('cat-nueva-padre');
    const padreId = selPadre.value ? parseInt(selPadre.value, 10) : null;

    const nombres = [...new Set(input.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 30);
    if (!nombres.length) { mostrarToast('Escribí el nombre de la categoría.', 'error'); input.focus(); return; }
    if (nombres.some(n => n.length > 40)) { mostrarToast('Cada nombre puede tener hasta 40 caracteres.', 'error'); return; }

    if (padreId !== null) {
        const nodo = aplanarCategoriasTienda().find(({ c }) => c.id === padreId);
        if (!nodo || nodo.depth >= MAX_NIVELES_CATEGORIA - 1) {
            mostrarToast(`Se permiten hasta ${MAX_NIVELES_CATEGORIA} niveles de categorías.`, 'error');
            return;
        }
    }
    const repetidos = nombres.filter(n => categoriaTiendaDuplicada(n, padreId));
    if (repetidos.length) { mostrarToast(`Ya existe: ${repetidos.join(', ')}`, 'error'); return; }

    let orden = categoriasTienda
        .filter(c => (c.parent_id ?? null) === padreId)
        .reduce((m, c) => Math.max(m, c.orden || 0), 0);
    const filas = nombres.map(n => ({ emprendedor_id: perfilActual.id, parent_id: padreId, nombre: n, orden: ++orden }));

    const btn = document.getElementById('btn-agregar-categoria');
    btn.disabled = true;
    const { error } = await supabase.from('categorias_tienda').insert(filas);
    btn.disabled = false;
    if (error) {
        console.error(error);
        mostrarToast('No pudimos guardar la categoría. Probá de nuevo.', 'error');
        return;
    }
    input.value = '';
    await cargarCategoriasTienda();
    mostrarToast(nombres.length === 1 ? 'Categoría creada.' : `${nombres.length} categorías creadas.`, 'success');
    input.focus();
}

async function guardarNombreCategoriaTienda(id, valor) {
    const nombre = (valor || '').trim();
    const c = categoriasTienda.find(x => x.id === id);
    if (!c) return;
    if (!nombre) { mostrarToast('El nombre no puede quedar vacío.', 'error'); return; }
    if (nombre.length > 40) { mostrarToast('Hasta 40 caracteres.', 'error'); return; }
    if (nombre !== c.nombre && categoriaTiendaDuplicada(nombre, c.parent_id, id)) {
        mostrarToast('Ya hay otra categoría con ese nombre en el mismo lugar.', 'error');
        return;
    }
    if (nombre !== c.nombre) {
        const { error } = await supabase.from('categorias_tienda').update({ nombre }).eq('id', id);
        if (error) { console.error(error); mostrarToast('No pudimos cambiar el nombre.', 'error'); return; }
    }
    categoriaTiendaEditandoId = null;
    await cargarCategoriasTienda();
}

async function moverCategoriaTienda(id, delta) {
    const nodo = aplanarCategoriasTienda().find(({ c }) => c.id === id);
    if (!nodo) return;
    const lista = [...nodo.hermanos];
    const i = lista.findIndex(c => c.id === id);
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];

    const cambios = lista
        .map((c, pos) => ({ c, orden: pos + 1 }))
        .filter(({ c, orden }) => c.orden !== orden);
    const resultados = await Promise.all(cambios.map(({ c, orden }) =>
        supabase.from('categorias_tienda').update({ orden }).eq('id', c.id)));
    if (resultados.some(r => r.error)) {
        console.error(resultados.find(r => r.error).error);
        mostrarToast('No pudimos reordenar.', 'error');
    }
    await cargarCategoriasTienda();
}

async function eliminarCategoriaTienda(id) {
    const c = categoriasTienda.find(x => x.id === id);
    if (!c) return;
    const ids = idsSubarbolCategoriaTienda(id);
    const subs = ids.size - 1;
    const prods = productosCache.filter(p => p.categoria_tienda_id != null && ids.has(p.categoria_tienda_id)).length;

    let mensaje = `Se va a eliminar «${c.nombre}»`;
    if (subs) mensaje += ` y ${subs === 1 ? 'su subcategoría' : `sus ${subs} subcategorías`}`;
    mensaje += '.';
    if (prods) mensaje += ` Los ${prods} producto${prods === 1 ? '' : 's'} que tenía no se borran: quedan sin categoría.`;

    const ok = await confirmarAccion(mensaje, { titulo: '¿Eliminar categoría?', textoConfirmar: 'Eliminar' });
    if (!ok) return;

    const { error } = await supabase.from('categorias_tienda').delete().eq('id', id);
    if (error) { console.error(error); mostrarToast('No pudimos eliminar la categoría.', 'error'); return; }
    await cargarCategoriasTienda();
    await renderProductos();
    mostrarToast('Categoría eliminada.', 'success');
}
