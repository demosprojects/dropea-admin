let perfilAdmin = null;
let emprendedoresCache = [];
let filtroEstadoActual = 'todos';
let busquedaActual = '';

document.addEventListener('DOMContentLoaded', async () => {
    perfilAdmin = await requerirSesion('admin');
    if (!perfilAdmin) return;

    await cargarEmprendedores();
    await actualizarBadgePostulacionesPendientes();
    iniciarRealtimeAdmin();
    iniciarBuscadorEmprendedores();
    iniciarBuscadorPostulaciones();
});

function iniciarBuscadorEmprendedores() {
    const input = document.getElementById('buscador-emprendedores');
    if (!input) return;
    input.addEventListener('input', debounce(() => {
        busquedaActual = input.value.trim().toLowerCase();
        document.getElementById('btn-limpiar-busqueda').classList.toggle('hidden', busquedaActual === '');
        renderEmprendedores();
    }, 200));
    setFiltroEmprendedores('todos');
}

function limpiarBusquedaEmprendedores() {
    const input = document.getElementById('buscador-emprendedores');
    input.value = '';
    busquedaActual = '';
    document.getElementById('btn-limpiar-busqueda').classList.add('hidden');
    renderEmprendedores();
    input.focus();
}

function setFiltroEmprendedores(filtro) {
    filtroEstadoActual = filtro;
    document.querySelectorAll('#filtro-estado-emprendedores .filtro-btn').forEach(btn => {
        btn.classList.toggle('filtro-activo', btn.dataset.filtro === filtro);
    });
    renderEmprendedores();
}

function iniciarRealtimeAdmin() {
    suscribirTabla('emprendedores', debounce(cargarEmprendedores, 350));
    suscribirTabla('productos', debounce(cargarProductosAdmin, 350));
    suscribirTabla('postulaciones', debounce(cargarPostulacionesAdmin, 350));
}

const NAV_BASE = "w-full text-left px-5 py-3 rounded-full transition-all duration-150 flex items-center gap-3 group text-[11px] font-black uppercase tracking-widest";
const NAV_ACTIVO = `${NAV_BASE} bg-white text-black shadow-[4px_4px_0_0_#facc15] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#facc15]`;
const NAV_INACTIVO = `${NAV_BASE} text-zinc-400 hover:text-yellow-400 hover:bg-white/5`;

function mostrarSeccion(id) {
    const secciones = ['emprendedores', 'productos', 'postulaciones'];
    secciones.forEach(s => {
        document.getElementById('section-' + s).classList.toggle('hidden', s !== id);
        document.getElementById('nav-' + s).className = s === id ? NAV_ACTIVO : NAV_INACTIVO;
    });
    if (id === 'productos') cargarProductosAdmin();
    if (id === 'postulaciones') cargarPostulacionesAdmin();
}


// Muestra el error real de Supabase (en vez de un cartel genérico) para poder
// saber si es un permiso (RLS), una columna que falta, etc.
function htmlErrorCarga(titulo, error) {
    const detalle = [error && error.message, error && error.code && `código ${error.code}`, error && error.hint]
        .filter(Boolean).map(escapeHtml).join(' · ');
    return `
        <div class="col-span-full flex flex-col items-center justify-center gap-2 py-24 text-center px-4">
            <span class="text-red-400 font-semibold">${escapeHtml(titulo)}</span>
            ${detalle ? `<span class="text-xs text-slate-400 max-w-xl break-words">${detalle}</span>` : ''}
        </div>`;
}

async function cargarEmprendedores() {
    const grid = document.getElementById('grid-emprendedores');

    // Se prueba de más completa a más simple: si falla el join con `usuarios`
    // (ej. no existe la columna email o el admin no puede leer esa tabla) la
    // lista igual se muestra, solo que sin ese dato.
    let { data, error } = await supabase
        .from('emprendedores')
        .select('*, usuarios(usuario, email)');
    if (error) {
        console.warn('Admin: falló la consulta con usuarios(usuario, email); reintento sin email.', error);
        ({ data, error } = await supabase.from('emprendedores').select('*, usuarios(usuario)'));
    }
    if (error) {
        console.warn('Admin: falló el join con usuarios; reintento sin join.', error);
        ({ data, error } = await supabase.from('emprendedores').select('*'));
    }

    if (error) {
        grid.innerHTML = htmlErrorCarga('Error cargando las tiendas.', error);
        document.getElementById('contador-emprendedores').textContent = '';
        console.error(error);
        return;
    }

    // Más nuevas primero (se ordena acá para no depender de que exista la columna en la consulta)
    emprendedoresCache = (data || []).sort((x, y) => String(y.created_at || '').localeCompare(String(x.created_at || '')));
    renderEmprendedores();
}

// Estado real de una tienda, con la misma regla que tienda.html (que pide activo = true):
//   true  -> activa (visible en /tienda/<usuario>)
//   false -> bloqueada por el admin
//   null  -> sin activar (la fila existe pero la tienda pública no la muestra)
// Además, si está activa pero terminó su mes gratis / su suscripción (misma regla
// que el panel del emprendedor y la tienda pública), el estado es 'sin_pago'.
function estadoTienda(e) {
    if (e.activo === true) {
        const acceso = calcularEstadoAcceso(e);
        return (acceso.bloqueado && acceso.motivo === 'pago') ? 'sin_pago' : 'activa';
    }
    if (e.activo === false) return 'bloqueada';
    return 'sin_activar';
}

function renderEmprendedores() {
    const grid = document.getElementById('grid-emprendedores');
    const contador = document.getElementById('contador-emprendedores');

    const base = emprendedoresCache;
    const total = base.length;

    if (total === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-3 py-24 text-center px-4">
                <div class="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">🏬</div>
                <p class="text-slate-500 font-bold">No se encontró ninguna tienda.</p>
                <p class="text-slate-400 text-sm max-w-md">Si ya hay tiendas creadas, lo más probable es que a tu usuario admin le falte el permiso de lectura sobre la tabla <strong>emprendedores</strong> en Supabase (RLS). Ejecutá el archivo <strong>permisos-admin.sql</strong> en el SQL Editor.</p>
            </div>`;
        contador.textContent = '';
        console.warn('Admin: la consulta a "emprendedores" devolvió 0 filas. Si existen tiendas, es un tema de permisos (RLS).');
        return;
    }

    let data = base;

    // Activa = visible en /tienda/<usuario> (activo = true). Bloqueada = el admin la bloqueó.
    // Sin activar = activo vacío: existe pero la tienda pública no la muestra.
    if (filtroEstadoActual === 'activo') data = data.filter(e => estadoTienda(e) === 'activa');
    if (filtroEstadoActual === 'bloqueado') data = data.filter(e => estadoTienda(e) !== 'activa');
    if (filtroEstadoActual === 'sin_pago') data = data.filter(e => estadoTienda(e) === 'sin_pago');

    if (busquedaActual) {
        data = data.filter(e => {
            const tienda = (e.nombre_tienda || '').toLowerCase();
            const usuario = (e.usuarios?.usuario || '').toLowerCase();
            const whatsapp = (e.whatsapp || '').toLowerCase();
            return tienda.includes(busquedaActual) || usuario.includes(busquedaActual) || whatsapp.includes(busquedaActual);
        });
    }

    const totalActivos = base.filter(e => estadoTienda(e) === 'activa').length;
    const totalSinPago = base.filter(e => estadoTienda(e) === 'sin_pago').length;
    contador.textContent = `${total} tienda${total === 1 ? '' : 's'} · ${totalActivos} activa${totalActivos === 1 ? '' : 's'}` +
        (totalSinPago ? ` · ${totalSinPago} sin pago` : '') +
        (data.length !== total ? ` · ${data.length} coincidencia${data.length === 1 ? '' : 's'}` : '');

    if (data.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div class="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl">🔎</div>
                <p class="text-slate-500 font-bold">No encontramos emprendedores con esos filtros.</p>
                <p class="text-slate-400 text-sm">Probá con otro término de búsqueda o cambiá el filtro.</p>
            </div>`;
        return;
    }

    grid.innerHTML = data.map(tarjetaEmprendedorHTML).join('');
}

// Link público de la tienda de un emprendedor (/tienda/<usuario>)
function urlTiendaPublica(e) {
    const usuario = e && e.usuarios && e.usuarios.usuario;
    if (!usuario) return '';
    return `${SITIO_PUBLICO}/tienda/${encodeURIComponent(String(usuario).trim().toLowerCase())}`;
}

// ¿La tienda recibe pedidos por WhatsApp? (misma regla que tienda.html / emprendedor.js)
function tiendaRecibePedidos(e) {
    return !!e && e.recibe_pedidos === true && String(e.whatsapp || '').replace(/\D/g, '').length > 0;
}

// Tarjeta de cada tienda en la grilla de "Emprendedores".
function tarjetaEmprendedorHTML(e) {
    const inicial = e.nombre_tienda ? e.nombre_tienda.charAt(0).toUpperCase() : '?';
    const avatar = e.logo_url
        ? `<img src="${miniaturaCloudinary(e.logo_url, 600)}" alt="${escapeHtml(e.nombre_tienda)}" class="w-full h-full object-cover" loading="lazy" decoding="async">`
        : `<div class="emp-inicial w-full h-full flex items-center justify-center bg-gradient-to-tr from-yellow-400 to-amber-300 text-black font-black">${escapeHtml(inicial)}</div>`;

    // Estado: activa o bloqueada por el admin.
    const estado = estadoTienda(e);
    const badge = estado === 'activa'
        ? { texto: 'Activa', clase: 'bg-emerald-500/95 text-white' }
        : estado === 'bloqueada'
            ? { texto: 'Bloqueada', clase: 'bg-red-500/95 text-white' }
            : estado === 'sin_pago'
                ? { texto: 'Sin pago', clase: 'bg-orange-500/95 text-white' }
                : { texto: 'Sin activar', clase: 'bg-amber-500/95 text-white' };

    // El estado se muestra de dos formas según el layout (ver .emp-* en admin.html):
    // encima de la foto en la tarjeta vertical, y dentro de la info en la tarjeta de lista.
    const claseBadge = `text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shadow-sm ${badge.clase}`;
    const badgeSobreFoto = `<span class="emp-badge-overlay absolute top-3 left-3 ${claseBadge}">${badge.texto}</span>`;
    const badgeEnInfo = `<span class="emp-badge-inline self-start mb-0.5 ${claseBadge}">${badge.texto}</span>`;

    const usuario = e.usuarios ? escapeHtml(e.usuarios.usuario) : '-';
    const nombre = escapeHtml(e.nombre_tienda);

    // activo === true cubre 'activa' y 'sin_pago': en ambos el botón es Bloquear.
    const estaActivo = e.activo === true;
    const textoBoton = estaActivo ? 'Bloquear' : 'Activar';
    const claseBoton = estaActivo
        ? 'bg-red-50 text-red-500 hover:bg-red-500 hover:text-white'
        : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white';
    const claseBotonAccion = 'w-full min-h-[2.5rem] px-3 py-2 rounded-xl font-black text-[11px] uppercase tracking-wide leading-tight transition-colors';

    const whatsapp = e.whatsapp
        ? `<svg class="w-3.5 h-3.5 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg><span class="truncate">${escapeHtml(e.whatsapp)}</span>`
        : '<span class="italic text-slate-400 truncate">Sin WhatsApp cargado</span>';

    return `
    <div class="emp-card group relative bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-slate-900/5 hover:-translate-y-0.5 hover:border-slate-300 transition-all duration-300 overflow-hidden flex flex-col cursor-pointer"
        onclick="abrirModalDetalleEmprendedor('${e.id}')">
        <div class="emp-top">
            <div class="emp-media bg-slate-100">
                ${avatar}
                ${badgeSobreFoto}
            </div>
            <div class="emp-info flex flex-col gap-1">
                ${badgeEnInfo}
                <span class="text-xs font-semibold text-slate-400 truncate">@${usuario}</span>
                <h3 class="font-extrabold text-slate-900 text-base leading-snug line-clamp-2">${nombre}</h3>
                <p class="flex items-center gap-1.5 min-w-0 text-sm font-medium text-slate-500">${whatsapp}</p>
            </div>
        </div>
        <div class="emp-actions mt-auto flex flex-col gap-2">
            ${estado === 'sin_pago' ? `<button onclick="event.stopPropagation(); asignarMesEmprendedor('${e.id}')"
                class="${claseBotonAccion} bg-emerald-500 text-white hover:bg-emerald-600">
                Asignar 1 mes (transferencia)
            </button>` : ''}
            <button onclick="event.stopPropagation(); toggleEmprendedor('${e.id}', ${estaActivo})"
                class="${claseBotonAccion} ${claseBoton}">
                ${textoBoton}
            </button>
        </div>
    </div>
`;
}

function abrirModalDetalleEmprendedor(id) {
    const e = emprendedoresCache.find(x => String(x.id) === String(id));
    if (!e) return;

    const formatoFecha = (iso) => iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

    // Banner (solo se muestra si el emprendedor cargó uno; si no, queda el
    // patrón de puntos de fondo definido en el HTML).
    const bannerWrap = document.getElementById('detalle-banner-wrap');
    const bannerImg = document.getElementById('detalle-banner');
    if (e.banner_url) {
        bannerImg.src = miniaturaCloudinary(e.banner_url, 800);
        bannerWrap.classList.remove('hidden');
    } else {
        bannerImg.src = '';
        bannerWrap.classList.add('hidden');
    }

    // Avatar / foto de perfil
    const avatarImg = document.getElementById('detalle-avatar');
    const avatarInicial = document.getElementById('detalle-avatar-inicial');
    if (e.logo_url) {
        avatarImg.src = miniaturaCloudinary(e.logo_url, 300);
        avatarImg.classList.remove('hidden');
        avatarInicial.classList.add('hidden');
    } else {
        avatarImg.classList.add('hidden');
        avatarImg.src = '';
        avatarInicial.classList.remove('hidden');
        avatarInicial.textContent = e.nombre_tienda ? e.nombre_tienda.charAt(0).toUpperCase() : '?';
    }

    document.getElementById('detalle-nombre-tienda').textContent = e.nombre_tienda || 'Sin nombre';
    document.getElementById('detalle-usuario').textContent = `@${e.usuarios ? e.usuarios.usuario : '-'}`;

    // Badge activa / bloqueada
    const badgeActivo = document.getElementById('detalle-badge-activo');
    const estadoDetalle = estadoTienda(e);
    if (estadoDetalle === 'activa') {
        badgeActivo.textContent = 'Activa';
        badgeActivo.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-emerald-100 text-emerald-700';
    } else if (estadoDetalle === 'bloqueada') {
        badgeActivo.textContent = 'Bloqueada';
        badgeActivo.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-red-100 text-red-700';
    } else if (estadoDetalle === 'sin_pago') {
        badgeActivo.textContent = 'Sin pago';
        badgeActivo.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-orange-100 text-orange-700';
    } else {
        badgeActivo.textContent = 'Sin activar';
        badgeActivo.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-amber-100 text-amber-700';
    }

    // Badge términos y condiciones
    const badgeTerminos = document.getElementById('detalle-badge-terminos');
    if (e.terminos_aceptados === true) {
        badgeTerminos.textContent = `Aceptó términos · ${formatoFecha(e.terminos_respondido_en)}`;
        badgeTerminos.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-emerald-100 text-emerald-700';
    } else if (e.terminos_aceptados === false) {
        badgeTerminos.textContent = `Rechazó términos · ${formatoFecha(e.terminos_respondido_en)}`;
        badgeTerminos.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-red-100 text-red-700';
    } else {
        badgeTerminos.textContent = 'Términos pendientes de respuesta';
        badgeTerminos.className = 'text-[10px] font-black uppercase px-2.5 py-1 rounded-full whitespace-nowrap bg-gray-100 text-gray-500';
    }

    // Motivo del bloqueo (si lo hay)
    const motivoWrap = document.getElementById('detalle-bloqueo-motivo');
    if (estadoDetalle === 'bloqueada') {
        motivoWrap.textContent = e.motivo_bloqueo ? `Motivo del bloqueo: ${e.motivo_bloqueo}` : 'Tienda bloqueada.';
        motivoWrap.classList.remove('hidden');
    } else if (estadoDetalle === 'sin_pago') {
        motivoWrap.textContent = 'La tienda no se muestra al público porque terminó su mes gratis o su suscripción y no pagó. Si ya te pagó por transferencia, tocá \"Asignar 1 mes\".';
        motivoWrap.classList.remove('hidden');
    } else if (estadoDetalle === 'sin_activar') {
        motivoWrap.textContent = 'Esta tienda todavía no está activada, por eso /tienda/<usuario> no la muestra. Tocá "Activar tienda" para publicarla.';
        motivoWrap.classList.remove('hidden');
    } else {
        motivoWrap.classList.add('hidden');
    }

    document.getElementById('detalle-bio').textContent = e.bio || 'Sin descripción cargada.';
    document.getElementById('detalle-email').textContent = (e.usuarios && e.usuarios.email) || '-';
    document.getElementById('detalle-whatsapp').textContent = e.whatsapp || '-';
    document.getElementById('detalle-ubicacion').textContent = e.ubicacion || '-';
    document.getElementById('detalle-horario').textContent = e.horario_atencion || '-';
    document.getElementById('detalle-costo-envio').textContent =
        (e.costo_envio !== null && e.costo_envio !== undefined && e.costo_envio !== '') ? formatoPrecio(e.costo_envio) : '-';

    const mapaEl = document.getElementById('detalle-mapa');
    mapaEl.innerHTML = e.mapa_url
        ? `<a href="${escapeHtml(e.mapa_url)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline break-all">Ver ubicación</a>`
        : '-';

    // Redes sociales
    const redesCont = document.getElementById('detalle-redes');
    const redes = [
        { url: e.instagram, label: 'Instagram' },
        { url: e.facebook, label: 'Facebook' },
        { url: e.tiktok, label: 'TikTok' },
    ].filter(r => r.url);
    redesCont.innerHTML = redes.length
        ? redes.map(r => `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="inline-flex items-center px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-xs font-bold hover:bg-gray-200 transition-colors">${r.label}</a>`).join('')
        : `<span class="text-sm text-gray-400">Sin redes cargadas</span>`;

    // Medios de pago
    const mediosCont = document.getElementById('detalle-medios-pago');
    const medios = e.medios_pago || [];
    mediosCont.innerHTML = medios.length
        ? medios.map(m => `<span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-700 text-xs font-bold">${escapeHtml(nombreMedioPago(m))}</span>`).join('')
        : `<span class="text-sm text-gray-400">Sin medios de pago cargados</span>`;

    // Modo de la tienda: catálogo o catálogo + pedidos por WhatsApp
    const pedidos = tiendaRecibePedidos(e);
    document.getElementById('detalle-modo').textContent = pedidos ? 'Recibe pedidos por WhatsApp' : 'Solo catálogo';
    const badgeModo = document.getElementById('detalle-modo-badge');
    badgeModo.textContent = pedidos ? 'Pedidos' : 'Catálogo';
    badgeModo.className = 'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide ' + (pedidos ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500');

    // Link a la tienda pública
    const btnVer = document.getElementById('detalle-btn-ver-tienda');
    const urlTienda = urlTiendaPublica(e);
    if (urlTienda) { btnVer.href = urlTienda; btnVer.classList.remove('hidden'); }
    else { btnVer.removeAttribute('href'); btnVer.classList.add('hidden'); }

    // Anuncio en tienda
    const anuncioWrap = document.getElementById('detalle-anuncio-wrap');
    if (e.anuncio) {
        document.getElementById('detalle-anuncio').textContent = e.anuncio;
        anuncioWrap.classList.remove('hidden');
    } else {
        anuncioWrap.classList.add('hidden');
    }

    document.getElementById('detalle-creado').textContent = e.created_at ? `Cuenta creada el ${formatoFecha(e.created_at)}` : '';

    // Suscripción: vencimiento y botón para asignar un mes (pago por transferencia).
    // Solo tiene sentido en tiendas activas (al día o sin pago); las bloqueadas
    // o sin activar se manejan primero con "Activar tienda".
    const suscWrap = document.getElementById('detalle-suscripcion-wrap');
    const tieneSusc = e.activo === true;
    suscWrap.classList.toggle('hidden', !tieneSusc);
    if (tieneSusc) {
        const acceso = calcularEstadoAcceso(e);
        const fechaCorta = (d) => d ? d.toLocaleDateString('es-AR') : '';
        const textoSusc = document.getElementById('detalle-suscripcion-texto');
        const badgeSusc = document.getElementById('detalle-suscripcion-badge');
        let texto = 'Sin fecha de vencimiento cargada';
        if (acceso.vencimiento) {
            if (estadoDetalle === 'sin_pago') texto = `${acceso.enPruebaGratis ? 'Su mes gratis terminó' : 'Su suscripción venció'} el ${fechaCorta(acceso.vencimiento)}`;
            else texto = `${acceso.enPruebaGratis ? 'Mes gratis hasta' : 'Al día hasta'} el ${fechaCorta(acceso.vencimiento)}`;
        }
        textoSusc.textContent = texto;
        badgeSusc.textContent = estadoDetalle === 'sin_pago' ? 'Sin pago' : (acceso.enPruebaGratis ? 'Mes gratis' : 'Al día');
        badgeSusc.className = 'px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wide ' +
            (estadoDetalle === 'sin_pago' ? 'bg-orange-100 text-orange-700' : (acceso.enPruebaGratis ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'));
        document.getElementById('detalle-btn-asignar-mes').onclick = () => asignarMesEmprendedor(e.id);
    }

    // Botón principal: bloquear / activar (activo === true cubre 'activa' y 'sin_pago')
    const btnToggle = document.getElementById('detalle-btn-toggle');
    const activa = e.activo === true;
    btnToggle.textContent = activa ? 'Bloquear tienda' : 'Activar tienda';
    btnToggle.className = `w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl font-black uppercase tracking-widest text-xs sm:text-sm transition-all active:scale-95 ${activa ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-black text-white hover:bg-yellow-400 hover:text-black'}`;
    btnToggle.onclick = () => {
        cerrarModalDetalleEmprendedor();
        toggleEmprendedor(e.id, activa);
    };

    document.getElementById('modal-detalle-overlay').classList.add('abierto');
    document.getElementById('modal-detalle').classList.add('abierto');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalDetalleEmprendedor() {
    document.getElementById('modal-detalle-overlay').classList.remove('abierto');
    document.getElementById('modal-detalle').classList.remove('abierto');
    document.body.classList.remove('overflow-hidden');
}

// Pago por transferencia: suma un mes a la suscripción del emprendedor.
// Si todavía tiene tiempo vigente (mes gratis o suscripción al día), el mes se
// suma a esa fecha; si ya venció, se cuenta desde hoy. Deja la cuenta como
// "authorized" con la nueva fecha de vencimiento (lo mismo que hace el Worker
// cuando se aprueba un pago con tarjeta), así el panel del emprendedor y la
// tienda pública vuelven a funcionar solos.
function sumarUnMes(fecha) {
    const f = new Date(fecha.getTime());
    const dia = f.getDate();
    f.setDate(1);
    f.setMonth(f.getMonth() + 1);
    const ultimoDia = new Date(f.getFullYear(), f.getMonth() + 1, 0).getDate();
    f.setDate(Math.min(dia, ultimoDia));
    return f;
}

async function asignarMesEmprendedor(id) {
    const e = emprendedoresCache.find(x => String(x.id) === String(id));
    if (!e) return;

    const acceso = calcularEstadoAcceso(e);
    const ahora = new Date();
    const base = (acceso.vencimiento && acceso.vencimiento.getTime() > ahora.getTime()) ? acceso.vencimiento : ahora;
    const nuevoVencimiento = sumarUnMes(base);

    const ok = await confirmarAccion(
        `${e.nombre_tienda || 'La tienda'} va a quedar al día hasta el ${nuevoVencimiento.toLocaleDateString('es-AR')}.`,
        { titulo: 'Asignar 1 mes pagado', textoConfirmar: 'Asignar mes', peligro: false }
    );
    if (!ok) return;

    const { error } = await supabase.from('emprendedores')
        .update({
            suscripcion_estado: 'authorized',
            fecha_vencimiento_suscripcion: nuevoVencimiento.toISOString(),
        })
        .eq('id', id);
    if (error) { mostrarToast('No se pudo asignar el mes.', 'error'); console.error(error); return; }

    cerrarModalDetalleEmprendedor();
    mostrarToast(`Mes asignado. Vence el ${nuevoVencimiento.toLocaleDateString('es-AR')}.`, 'success');
    await cargarEmprendedores();
}

async function toggleEmprendedor(id, activoActual) {
    // Bloquear (estaba activo) -> pedimos motivo antes de confirmar, así el
    // emprendedor lo ve reflejado en su panel de gestión (dashboard.html).
    if (activoActual) {
        abrirModalBloqueo(id);
        return;
    }

    // Activar (estaba bloqueado) -> directo, sin pedir motivo, y limpiamos
    // el motivo/fecha del bloqueo anterior.
    const { error } = await supabase.from('emprendedores')
        .update({ activo: true, motivo_bloqueo: null, bloqueado_en: null })
        .eq('id', id);
    if (error) { mostrarToast('No se pudo actualizar el estado.', 'error'); console.error(error); return; }
    mostrarToast('Emprendedor activado.', 'success');
    await cargarEmprendedores();
}

function abrirModalBloqueo(id) {
    document.getElementById('bloqueo-emprendedor-id').value = id;
    document.getElementById('bloqueo-motivo-select').value = 'Inactividad de la tienda';
    document.getElementById('bloqueo-detalle').value = '';
    document.getElementById('modal-bloqueo').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalBloqueo() {
    document.getElementById('modal-bloqueo').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

document.getElementById('form-bloqueo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('bloqueo-emprendedor-id').value;
    const select = document.getElementById('bloqueo-motivo-select');
    const detalle = document.getElementById('bloqueo-detalle').value.trim();

    let motivo = select.value === 'otro' ? '' : select.options[select.selectedIndex].text;
    if (detalle) motivo = motivo ? `${motivo}. ${detalle}` : detalle;
    if (!motivo) motivo = 'Tu tienda fue bloqueada por el equipo de Dropea.';

    const btn = document.getElementById('btn-confirmar-bloqueo');
    btn.disabled = true;

    const { error } = await supabase.from('emprendedores')
        .update({ activo: false, motivo_bloqueo: motivo, bloqueado_en: new Date().toISOString() })
        .eq('id', id);

    btn.disabled = false;

    if (error) { mostrarToast('No se pudo bloquear al emprendedor.', 'error'); console.error(error); return; }

    mostrarToast('Emprendedor bloqueado.', 'success');
    cerrarModalBloqueo();
    await cargarEmprendedores();
});

async function cargarProductosAdmin() {
    const tabla = document.getElementById('tabla-productos-admin');
    const { data, error } = await supabase
        .from('productos')
        .select('*, emprendedores(nombre_tienda)')
        .order('created_at', { ascending: false });

    if (error) { tabla.innerHTML = `<div class="p-8 text-center text-red-400 font-semibold">Error cargando productos.</div>`; return; }

    if (data.length === 0) {
        tabla.innerHTML = `<div class="p-8 text-center text-slate-400 font-semibold">No hay productos cargados todavía.</div>`;
        return;
    }

    tabla.innerHTML = data.map(p => `
        <div class="bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm p-2.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:shadow-md transition-shadow">
            <div class="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <img src="${urlGrillaProducto(p, 60) || IMAGEN_PRODUCTO_DEFAULT}" class="w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl object-cover border border-slate-100 bg-slate-100 flex-shrink-0" loading="lazy" decoding="async">
                <div class="min-w-0">
                    <p class="font-bold sm:font-extrabold text-slate-900 text-sm sm:text-base truncate">${escapeHtml(p.nombre)}</p>
                    <p class="text-[10px] sm:text-xs text-slate-400 truncate">${p.emprendedores ? escapeHtml(p.emprendedores.nombre_tienda) : '-'}</p>
                </div>
            </div>
            <div class="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 flex-shrink-0 pl-[50px] sm:pl-0">
                <span class="font-black text-slate-900 text-sm sm:text-base whitespace-nowrap">${formatoPrecio(p.precio)}</span>
                <span class="text-[8px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 sm:px-2 sm:py-1 rounded-full whitespace-nowrap ${p.activo ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}">
                    ${p.activo ? 'Visible' : 'Oculto'}
                </span>
                <button onclick="eliminarProductoAdmin('${p.id}')" class="text-red-400 hover:text-red-600 font-black text-[8px] sm:text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap">Eliminar</button>
            </div>
        </div>
    `).join('');
}

async function eliminarProductoAdmin(id) {
    const confirmado = await confirmarAccion(
        'Esta acción no se puede deshacer.',
        { titulo: '¿Eliminar este producto de la plataforma?', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    // Guardamos las URLs de las fotos antes de borrar la fila, para limpiar el storage después.
    const { data: prod } = await supabase.from('productos').select('imagen_url, imagen_thumb_url').eq('id', id).maybeSingle();

    const { error } = await supabase.from('productos').delete().eq('id', id);
    if (error) { mostrarToast('No se pudo eliminar el producto.', 'error'); console.error(error); return; }

    if (prod && typeof borrarImagenProductoSupabase === 'function') {
        borrarImagenProductoSupabase(prod.imagen_url, prod.imagen_thumb_url); // no crítico: si falla solo loguea
    }
    mostrarToast('Producto eliminado.', 'success');
    await cargarProductosAdmin();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}
// ============================================================
// POSTULACIONES: solicitudes de alta enviadas desde el botón
// "Quiero mi web" del sitio público (registro.html).
// ============================================================
let postulacionesCache = [];
let filtroEstadoPostulacionesActual = 'pendiente';
let busquedaPostulacionesActual = '';

const POSTULACION_TIPO_LABEL = {
    emprendedor: 'Emprendedor',
    comercio_vender: 'Comercio · Vender',
    comercio_membresia: 'Comercio · Membresía',
    solo_beneficios: 'Beneficios',
};
const POSTULACION_TIPO_COLOR = {
    emprendedor: 'bg-yellow-100 text-yellow-800',
    comercio_vender: 'bg-blue-100 text-blue-700',
    comercio_membresia: 'bg-purple-100 text-purple-700',
    solo_beneficios: 'bg-pink-100 text-pink-700',
};
const POSTULACION_ESTADO_LABEL = {
    pendiente: 'Pendiente',
    contactado: 'Contactado',
    aprobada: 'Aprobada',
    rechazada: 'Rechazada',
};
const POSTULACION_ESTADO_COLOR = {
    pendiente: 'bg-amber-100 text-amber-800',
    contactado: 'bg-blue-100 text-blue-700',
    aprobada: 'bg-emerald-100 text-emerald-700',
    rechazada: 'bg-rose-100 text-rose-700',
};

async function actualizarBadgePostulacionesPendientes() {
    const { count, error } = await supabase
        .from('postulaciones')
        .select('id', { count: 'exact', head: true })
        .eq('estado', 'pendiente');

    const badge = document.getElementById('badge-postulaciones-pendientes');
    if (error || !count) { badge.classList.add('hidden'); return; }
    badge.textContent = count;
    badge.classList.remove('hidden');
}

async function cargarPostulacionesAdmin() {
    const cont = document.getElementById('lista-postulaciones');
    const { data, error } = await supabase
        .from('postulaciones')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        cont.innerHTML = `<div class="p-8 text-center text-red-400 font-semibold">Error cargando postulaciones.</div>`;
        console.error(error);
        return;
    }

    postulacionesCache = data;
    renderPostulaciones();
    actualizarBadgePostulacionesPendientes();
}

function setFiltroEstadoPostulaciones(filtro) {
    filtroEstadoPostulacionesActual = filtro;
    document.querySelectorAll('#filtro-estado-postulaciones .filtro-btn').forEach(btn => {
        btn.classList.toggle('filtro-activo', btn.dataset.filtro === filtro);
    });
    renderPostulaciones();
}

function iniciarBuscadorPostulaciones() {
    const input = document.getElementById('buscador-postulaciones');
    if (!input) return;
    input.addEventListener('input', debounce(() => {
        busquedaPostulacionesActual = input.value.trim().toLowerCase();
        document.getElementById('btn-limpiar-busqueda-postulaciones').classList.toggle('hidden', busquedaPostulacionesActual === '');
        renderPostulaciones();
    }, 200));
}

function limpiarBusquedaPostulaciones() {
    const input = document.getElementById('buscador-postulaciones');
    input.value = '';
    busquedaPostulacionesActual = '';
    document.getElementById('btn-limpiar-busqueda-postulaciones').classList.add('hidden');
    renderPostulaciones();
    input.focus();
}

function renderPostulaciones() {
    const cont = document.getElementById('lista-postulaciones');
    const contador = document.getElementById('contador-postulaciones');

    let lista = postulacionesCache;
    if (filtroEstadoPostulacionesActual !== 'todos') {
        lista = lista.filter(p => p.estado === filtroEstadoPostulacionesActual);
    }
    if (busquedaPostulacionesActual) {
        lista = lista.filter(p => {
            const nombre = (p.nombre || '').toLowerCase();
            const negocio = (p.nombre_negocio || '').toLowerCase();
            const whatsapp = (p.whatsapp || '').toLowerCase();
            const email = (p.email || '').toLowerCase();
            return nombre.includes(busquedaPostulacionesActual) || negocio.includes(busquedaPostulacionesActual)
                || whatsapp.includes(busquedaPostulacionesActual) || email.includes(busquedaPostulacionesActual);
        });
    }

    contador.textContent = `${lista.length} postulación${lista.length === 1 ? '' : 'es'}`;

    if (lista.length === 0) {
        const etiquetaEstado = (POSTULACION_ESTADO_LABEL[filtroEstadoPostulacionesActual] || '').toLowerCase();
        cont.innerHTML = `<div class="p-8 text-center text-slate-400 font-semibold">No hay postulaciones ${etiquetaEstado ? etiquetaEstado + 's' : ''} con este filtro.</div>`;
        return;
    }

    cont.innerHTML = lista.map(p => `
        <button onclick="abrirModalPostulacionDetalle(${p.id})" class="w-full text-left bg-white rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm p-3.5 sm:p-4 flex items-center gap-3 hover:shadow-md hover:border-slate-300 transition-all">
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap mb-1">
                    <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${POSTULACION_TIPO_COLOR[p.tipo] || 'bg-slate-100 text-slate-600'}">${POSTULACION_TIPO_LABEL[p.tipo] || p.tipo}</span>
                    <span class="text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${POSTULACION_ESTADO_COLOR[p.estado] || 'bg-slate-100 text-slate-600'}">${POSTULACION_ESTADO_LABEL[p.estado] || p.estado}</span>
                </div>
                <p class="font-bold text-slate-900 text-sm truncate">${escapeHtml(p.nombre)}${p.nombre_negocio ? ' · ' + escapeHtml(p.nombre_negocio) : ''}</p>
                <p class="text-xs text-slate-400 truncate">${escapeHtml(p.whatsapp)} · ${escapeHtml(p.email)}</p>
            </div>
            <span class="text-slate-300 flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
            </span>
        </button>
    `).join('');
}

function abrirModalPostulacionDetalle(id) {
    const p = postulacionesCache.find(x => x.id === id);
    if (!p) return;

    document.getElementById('pd-id').value = p.id;
    document.getElementById('pd-badge-tipo').textContent = POSTULACION_TIPO_LABEL[p.tipo] || p.tipo;
    document.getElementById('pd-badge-tipo').className = `text-[10px] font-black uppercase px-2.5 py-1 rounded-full ${POSTULACION_TIPO_COLOR[p.tipo] || 'bg-slate-100 text-slate-600'}`;
    document.getElementById('pd-nombre').textContent = p.nombre;
    document.getElementById('pd-negocio').textContent = p.nombre_negocio || '—';
    document.getElementById('pd-whatsapp').textContent = p.whatsapp;
    document.getElementById('pd-email').textContent = p.email;
    document.getElementById('pd-ciudad').textContent = p.ciudad || '—';
    document.getElementById('pd-categoria').textContent = p.categoria || '—';

    const wrapIg = document.getElementById('pd-instagram-wrap');
    if (p.instagram) {
        wrapIg.classList.remove('hidden');
        document.getElementById('pd-instagram').textContent = p.instagram;
    } else {
        wrapIg.classList.add('hidden');
    }

    document.getElementById('pd-mensaje').textContent = p.mensaje || 'Sin mensaje adicional.';
    document.getElementById('pd-creado').textContent = 'Recibida el ' + new Date(p.created_at).toLocaleString('es-AR');

    document.getElementById('modal-postulacion-detalle').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function cerrarModalPostulacionDetalle() {
    document.getElementById('modal-postulacion-detalle').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

async function actualizarEstadoPostulacion(estado) {
    const id = document.getElementById('pd-id').value;
    if (!id) return;

    const { error } = await supabase.from('postulaciones').update({ estado }).eq('id', id);
    if (error) { mostrarToast('No se pudo actualizar el estado.', 'error'); return; }

    mostrarToast('Postulación marcada como ' + (POSTULACION_ESTADO_LABEL[estado] || estado).toLowerCase() + '.', 'success');
    cerrarModalPostulacionDetalle();
    await cargarPostulacionesAdmin();
}

async function eliminarPostulacion() {
    const id = document.getElementById('pd-id').value;
    if (!id) return;

    const confirmado = await confirmarAccion(
        'Esta acción no se puede deshacer.',
        { titulo: '¿Eliminar esta postulación?', textoConfirmar: 'Eliminar' }
    );
    if (!confirmado) return;

    const { error } = await supabase.from('postulaciones').delete().eq('id', id);
    if (error) { mostrarToast('No se pudo eliminar la postulación.', 'error'); return; }

    mostrarToast('Postulación eliminada.', 'success');
    cerrarModalPostulacionDetalle();
    await cargarPostulacionesAdmin();
}
