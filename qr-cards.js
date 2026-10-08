// ============================================================
// TARJETAS QR PARA IMPRIMIR — Cartel de mostrador, Sticker e Historia IG
// Depende de: perfilActual, emprendedorActual (definidos en dashboard.js),
// miniaturaCloudinary() (definida en supabase-client.js),
// y de las libs QRCode (cdn "qrcode") y htmlToImage (cdn "html-to-image").
//
// Vive dentro de #section-qr (una sección más del dashboard, no un modal):
// dashboard.js llama a renderFormatoQR() al entrar a esa sección.
// ============================================================

const FORMATOS_QR = {
    poster: {
        label: 'Cartel de Mostrador',
        sub: 'A5 vertical · para portahojas o stand',
        ancho: 480, alto: 600,
        archivo: 'cartel-mostrador',
    },
    sticker: {
        label: 'Sticker / Tarjeta',
        sub: 'Cuadrado · vidriera, bolsas o pedidos',
        ancho: 480, alto: 480,
        archivo: 'sticker-pedido',
    },
    story: {
        label: 'Historia de Instagram',
        sub: 'Vertical · para Stories o WhatsApp',
        ancho: 405, alto: 720,
        archivo: 'historia-instagram',
    },
};

// Paleta = un solo color de acento (el resto del diseño usa siempre negro/blanco
// para que el contraste quede garantizado sin importar qué acento se elija).
const PALETAS_QR = {
    amarillo:   { label: 'Amarillo',    acento: '#facc15' },
    lima:       { label: 'Lima',        acento: '#a3e635' },
    verde:      { label: 'Verde',       acento: '#4ade80' },
    esmeralda:  { label: 'Esmeralda',   acento: '#34d399' },
    menta:      { label: 'Menta',       acento: '#5eead4' },
    turquesa:   { label: 'Turquesa',    acento: '#2dd4bf' },
    aguamarina: { label: 'Aguamarina',  acento: '#2dd4bf' },
    cyan:       { label: 'Cian',        acento: '#22d3ee' },
    celeste:    { label: 'Celeste',     acento: '#38bdf8' },
    azul:       { label: 'Azul',        acento: '#60a5fa' },
    azul_oceano:{ label: 'Azul océano', acento: '#3b82f6' },
    azul_real:  { label: 'Azul real',   acento: '#2563eb' },
    azul_noche: { label: 'Azul noche',  acento: '#1e40af' },
    indigo:     { label: 'Índigo',      acento: '#818cf8' },
    lavanda:    { label: 'Lavanda',     acento: '#c4b5fd' },
    violeta:    { label: 'Violeta',     acento: '#a78bfa' },
    morado:     { label: 'Morado',      acento: '#c084fc' },
    uva:        { label: 'Uva',          acento: '#9333ea' },
    fucsia:     { label: 'Fucsia',      acento: '#e879f9' },
    magenta:    { label: 'Magenta',     acento: '#d946ef' },
    rosa:       { label: 'Rosa',        acento: '#f472b6' },
    rosa_pastel: { label: 'Rosa pastel', acento: '#f9a8d4' },
    frambuesa:  { label: 'Frambuesa',   acento: '#e11d48' },
    coral:      { label: 'Coral',       acento: '#fb7185' },
    salmon:     { label: 'Salmón',      acento: '#fb7185' },
    rojo:       { label: 'Rojo',        acento: '#ef4444' },
    rojo_oscuro:{ label: 'Rojo oscuro', acento: '#b91c1c' },
    bordo:      { label: 'Bordó',       acento: '#9f1239' },
    naranja:    { label: 'Naranja',     acento: '#fb923c' },
    mandarina:  { label: 'Mandarina',   acento: '#f97316' },
    durazno:    { label: 'Durazno',     acento: '#fdba74' },
    terracota:  { label: 'Terracota',   acento: '#c2410c' },
    dorado:     { label: 'Dorado',      acento: '#fbbf24' },
    mostaza:    { label: 'Mostaza',     acento: '#eab308' },
    beige:      { label: 'Beige',       acento: '#d6b98c' },
    marron:     { label: 'Marrón',      acento: '#a16207' },
    chocolate:  { label: 'Chocolate',   acento: '#78350f' },
    blanco:     { label: 'Blanco y negro', acento: '#f4f4f5' },
    plata:      { label: 'Plata',       acento: '#d4d4d8' },
    gris:       { label: 'Gris',        acento: '#a1a1aa' },
    grafito:    { label: 'Grafito',     acento: '#52525b' },
    negro:      { label: 'Negro',       acento: '#18181b' },
};
// Tipografías: además de la Plus Jakarta Sans que ya usa todo el dashboard,
// sumamos 3 estilos bien distintos (cargadas en dashboard.html vía Google Fonts).
const FUENTES_QR = {
    jakarta:   { label: 'Moderna',       family: "'Plus Jakarta Sans', sans-serif" },
    poppins:   { label: 'Redondeada',    family: "'Poppins', sans-serif" },
    montserrat:{ label: 'Geométrica',    family: "'Montserrat', sans-serif" },
    inter:     { label: 'Minimalista',   family: "'Inter', sans-serif" },
    roboto:    { label: 'Clásica',       family: "'Roboto', sans-serif" },
    nunito:    { label: 'Amigable',      family: "'Nunito', sans-serif" },
    outfit:    { label: 'Contemporánea', family: "'Outfit', sans-serif" },
    raleway:   { label: 'Fina',          family: "'Raleway', sans-serif" },
    oswald:    { label: 'Estrecha',      family: "'Oswald', sans-serif" },
    bebas:     { label: 'Potente',       family: "'Bebas Neue', sans-serif" },
    anton:     { label: 'Impacto',       family: "'Anton', sans-serif" },
    archivo:   { label: 'Profesional',   family: "'Archivo', sans-serif" },
    barlow:    { label: 'Tecnológica',   family: "'Barlow', sans-serif" },
    space:     { label: 'Futurista',     family: "'Space Grotesk', sans-serif" },
    orbitron:  { label: 'Digital',       family: "'Orbitron', sans-serif" },

    playfair:  { label: 'Elegante',      family: "'Playfair Display', serif" },
    cormorant: { label: 'Sofisticada',   family: "'Cormorant Garamond', serif" },
    lora:      { label: 'Editorial',     family: "'Lora', serif" },
    merriweather:{ label: 'Tradicional', family: "'Merriweather', serif" },
    libre:     { label: 'Clásica',       family: "'Libre Baskerville', serif" },

    dancing:   { label: 'Manuscrita',   family: "'Dancing Script', cursive" },
    greatvibes:{ label: 'Caligráfica',   family: "'Great Vibes', cursive" },
    pacifico:  { label: 'Casual',        family: "'Pacifico', cursive" },
    lobster:   { label: 'Decorativa',    family: "'Lobster', cursive" },
    caveat:    { label: 'Escrita',       family: "'Caveat', cursive" },
};

let formatoQRActivo = 'poster';
let paletaQRActiva = 'azul_noche';
let fuenteQRActiva = 'jakarta';
let qrDataUrlCache = null; // el QR es siempre el mismo link, lo generamos una sola vez

// Usa SITIO_PUBLICO (definido en supabase-client.js) en vez de window.location.origin,
// porque este panel puede vivir en un dominio distinto (Vercel) al del sitio
// público (Cloudflare), donde realmente está emprendedor.html.
function obtenerLinkTienda() {
    return urlPerfilPublico(); // mismo link que "Ver perfil" (/tienda/<usuario>)
}

async function generarQRDataUrl() {
    if (qrDataUrlCache) return qrDataUrlCache;
    const link = obtenerLinkTienda();

    // qrcodejs dibuja el QR directo en un elemento del DOM (canvas + img),
    // no devuelve una promesa: lo hacemos en un contenedor invisible y
    // leemos el resultado apenas termina de dibujar (es sincrónico).
    const contenedorTemporal = document.createElement('div');
    contenedorTemporal.style.position = 'fixed';
    contenedorTemporal.style.left = '-9999px';
    document.body.appendChild(contenedorTemporal);

    // El QR en sí queda siempre en negro sobre blanco (sin importar la paleta
    // elegida): es lo que garantiza el contraste mínimo para que escanee bien.
    new QRCode(contenedorTemporal, {
        text: link,
        width: 500,
        height: 500,
        colorDark: '#0b0c10',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
    });

    const img = contenedorTemporal.querySelector('img');
    const canvas = contenedorTemporal.querySelector('canvas');
    qrDataUrlCache = (img && img.src) || (canvas && canvas.toDataURL('image/png'));

    contenedorTemporal.remove();

    if (!qrDataUrlCache) throw new Error('No se pudo generar el código QR.');
    return qrDataUrlCache;
}

// Marco tipo "visor de cámara" alrededor del QR: 4 esquinas en L.
function construirEsquinasQR(color = '#0b0c10', tamano = 20, grosor = 4) {
    const base = `position:absolute; width:${tamano}px; height:${tamano}px; border-color:${color}; border-style:solid;`;
    return `
        <div style="${base} top:-${grosor}px; left:-${grosor}px; border-width:${grosor}px 0 0 ${grosor}px; border-top-left-radius:8px;"></div>
        <div style="${base} top:-${grosor}px; right:-${grosor}px; border-width:${grosor}px ${grosor}px 0 0; border-top-right-radius:8px;"></div>
        <div style="${base} bottom:-${grosor}px; left:-${grosor}px; border-width:0 0 ${grosor}px ${grosor}px; border-bottom-left-radius:8px;"></div>
        <div style="${base} bottom:-${grosor}px; right:-${grosor}px; border-width:0 ${grosor}px ${grosor}px 0; border-bottom-right-radius:8px;"></div>
    `;
}

// Textura de puntos sutil (efecto impresión/serigrafía) para fondos amarillos u oscuros.
function estiloPuntos(colorPunto, tamanoPunto = 1.5, espaciado = 16) {
    return `background-image: radial-gradient(${colorPunto} ${tamanoPunto}px, transparent ${tamanoPunto}px); background-size: ${espaciado}px ${espaciado}px;`;
}

// Convierte un hex (#rrggbb o #rgb) a rgba(...) para poder aplicar opacidad
// al color de acento elegido (los blobs decorativos usan el acento "diluido").
function hexARgba(hex, alpha) {
    const limpio = String(hex).replace('#', '');
    const completo = limpio.length === 3 ? limpio.split('').map(c => c + c).join('') : limpio;
    const num = parseInt(completo, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ------------------------------------------------------------
// Identidad visual Dropea para los carteles: negro de marca, acento (amarillo
// por defecto), destellos de 4 puntas del logo, títulos en mayúsculas cursivas
// y la "sombra dura" de los botones de la web. El acento es lo único que cambia
// con la paleta; negro/blanco son fijos para garantizar contraste y lectura del QR.
// ------------------------------------------------------------
const NEGRO_DROPEA = '#09090b';
const RUTA_LOGO_DROPEA = 'dropea-logo.png';

// Luminancia relativa (WCAG) de un hex: sirve para saber si el acento elegido es
// tan oscuro que el texto negro (o el acento sobre fondo negro) no se leería.
function luminanciaHex(hex) {
    const limpio = String(hex).replace('#', '');
    const completo = limpio.length === 3 ? limpio.split('').map(c => c + c).join('') : limpio;
    const num = parseInt(completo, 16);
    const canal = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * canal((num >> 16) & 255) + 0.7152 * canal((num >> 8) & 255) + 0.0722 * canal(num & 255);
}

// Destello de 4 puntas (mismo trazo que el logo y el footer de la web).
function destelloQR(color, tam, posicion, opacidad = 1) {
    return `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" style="position:absolute; z-index:5; ${posicion}" fill="${color}" fill-opacity="${opacidad}"><path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z"/></svg>`;
}

// El logo de la web es oscuro sobre transparente (en el footer se usa con "invert").
// Lo cargamos una sola vez y generamos las dos versiones como data URL: así la
// exportación a PNG no depende de filtros CSS ni de pedir el archivo otra vez.
// Si el archivo no está o el navegador no deja leerlo, queda el texto "Dropea".
let logoDropeaCache = null;
async function cargarLogoDropea() {
    if (logoDropeaCache !== null) return logoDropeaCache;
    try {
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = reject;
            i.src = RUTA_LOGO_DROPEA;
        });
        const escala = Math.min(1, 240 / img.naturalHeight);
        const w = Math.max(1, Math.round(img.naturalWidth * escala));
        const h = Math.max(1, Math.round(img.naturalHeight * escala));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const normal = canvas.toDataURL('image/png');
        const px = ctx.getImageData(0, 0, w, h);
        for (let i = 0; i < px.data.length; i += 4) {
            px.data[i] = 255 - px.data[i];
            px.data[i + 1] = 255 - px.data[i + 1];
            px.data[i + 2] = 255 - px.data[i + 2];
        }
        ctx.putImageData(px, 0, 0);
        logoDropeaCache = { normal, invertido: canvas.toDataURL('image/png') };
    } catch (err) {
        console.warn('No se pudo cargar el logo de Dropea para los carteles:', err);
        logoDropeaCache = false;
    }
    return logoDropeaCache;
}

// claro = true -> versión blanca (para fondos oscuros)
function logoDropeaHtml(dropea, claro, alto) {
    if (dropea && dropea.normal) {
        return `<img src="${claro ? dropea.invertido : dropea.normal}" alt="Dropea" style="height:${alto}px; width:auto; display:block;" />`;
    }
    return `<span style="display:block; font-size:${Math.round(alto * 0.8)}px; line-height:1; font-weight:800; font-style:italic; text-transform:uppercase; letter-spacing:-0.02em; color:${claro ? '#ffffff' : NEGRO_DROPEA};">Dropea</span>`;
}

// Achica el nombre según su largo para que nunca desborde ni pise el QR.
function tamanoNombreQR(nombre, base) {
    const n = String(nombre).length;
    if (n <= 14) return base;
    if (n <= 22) return Math.round(base * 0.82);
    if (n <= 32) return Math.round(base * 0.68);
    return Math.round(base * 0.56);
}
const ESTILO_NOMBRE_QR = 'text-transform:uppercase; font-style:italic; font-weight:800; letter-spacing:-0.02em; line-height:1.06; text-align:center; word-break:break-word; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;';

// Arma el HTML interno de cada formato. logoUrl/nombre ya vienen resueltos.
// paleta y fuente son entradas de PALETAS_QR / FUENTES_QR: todo el color y la
// tipografía del diseño salen de acá, el resto de la estructura es fija.
function construirTarjetaHTML(formato, { nombre, logoUrl, qr, host, paleta, fuente, dropea }) {
    const acento = paleta.acento;
    const oscuro = luminanciaHex(acento) < 0.18;
    // Acento usable como texto/relleno sobre negro (si es muy oscuro, pasa a blanco)
    const acTexto = oscuro ? '#ffffff' : acento;
    // Color de texto/trazo sobre un fondo del color del acento
    const sobreAcento = oscuro ? '#ffffff' : NEGRO_DROPEA;
    const estiloFuente = `font-family:${fuente.family};`;
    const nombreSeguro = (typeof escapeHtml === 'function') ? escapeHtml(nombre) : nombre;
    const esquinas = construirEsquinasQR(NEGRO_DROPEA, 20, 4);

    if (formato === 'poster') {
        const tam = tamanoNombreQR(nombre, 23);
        const logoTienda = logoUrl
            ? `<img src="${logoUrl}" crossorigin="anonymous" style="width:54px; height:54px; border-radius:16px; object-fit:cover; border:2px solid ${NEGRO_DROPEA}; flex-shrink:0;" />`
            : '';
        return `
            <div style="width:480px; height:600px; position:relative; overflow:hidden; display:flex; flex-direction:column; background-color:${acento}; ${estiloFuente} ${estiloPuntos(oscuro ? 'rgba(255,255,255,0.10)' : 'rgba(9,9,11,0.12)', 1.6, 15)}">
                ${destelloQR(sobreAcento, 50, oscuro ? 'top:44px; right:14px;' : 'top:74px; right:12px;')}
                ${destelloQR(sobreAcento, 20, 'bottom:132px; left:30px;', 0.85)}

                <div style="display:flex; align-items:center; justify-content:space-between; padding:26px 30px 0;">
                    ${logoDropeaHtml(dropea, oscuro, 34)}
                    <span style="background:${NEGRO_DROPEA}; color:${acTexto}; ${oscuro ? 'border:1px solid rgba(255,255,255,0.25);' : ''} border-radius:9999px; padding:7px 14px; font-size:10px; font-weight:800; letter-spacing:0.2em; text-transform:uppercase; white-space:nowrap;">Catálogo online</span>
                </div>

                <div style="margin:22px 30px 0; position:relative; z-index:2; background:#ffffff; border:3px solid ${NEGRO_DROPEA}; border-radius:30px; box-shadow:7px 7px 0 0 ${oscuro ? 'rgba(255,255,255,0.35)' : NEGRO_DROPEA}; padding:22px 22px 20px; display:flex; flex-direction:column; align-items:center; gap:12px;">
                    ${logoTienda}
                    <div style="width:100%; color:${NEGRO_DROPEA}; font-size:${tam}px; ${ESTILO_NOMBRE_QR}">${nombreSeguro}</div>
                    <div style="position:relative; padding:6px;">
                        ${esquinas}
                        <img src="${qr}" crossorigin="anonymous" style="width:184px; height:184px; border-radius:10px; display:block;" />
                    </div>
                </div>

                <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:0 24px;">
                    <div style="align-self:stretch; color:${sobreAcento}; font-size:34px; font-weight:800; font-style:italic; text-transform:uppercase; line-height:1.02; letter-spacing:-0.02em; text-align:center;">
                        <div style="white-space:nowrap;">Escaneá el</div>
                        <div style="white-space:nowrap;">código</div>
                    </div>
                    <div style="margin-top:10px; background:${NEGRO_DROPEA}; color:${acTexto}; ${oscuro ? 'border:1px solid rgba(255,255,255,0.25);' : ''} border-radius:9999px; padding:7px 16px; font-size:10.5px; font-weight:800; letter-spacing:0.16em; text-transform:uppercase; white-space:nowrap;">Catálogo, precios y pedidos</div>
                </div>

                <div style="background:${NEGRO_DROPEA}; border-radius:26px 26px 0 0; padding:15px 20px 17px; display:flex; align-items:center; justify-content:center; gap:10px; ${oscuro ? 'border-top:1px solid rgba(255,255,255,0.25);' : ''}">
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="${acTexto}" style="flex-shrink:0;"><path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z"/></svg>
                    <span style="color:#e4e4e7; font-size:11px; font-weight:800; letter-spacing:0.2em; text-transform:uppercase; white-space:nowrap;">${host}</span>
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="${acTexto}" style="flex-shrink:0;"><path d="M12 0c.6 6.2 5.8 11.4 12 12-6.2.6-11.4 5.8-12 12-.6-6.2-5.8-11.4-12-12C6.2 11.4 11.4 6.2 12 0z"/></svg>
                </div>
            </div>`;
    }

    if (formato === 'sticker') {
        const tam = tamanoNombreQR(nombre, 28);
        return `
            <div style="width:480px; height:480px; position:relative; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; padding:0 40px; text-align:center; background:${NEGRO_DROPEA}; ${estiloFuente}">
                <div style="position:absolute; top:-150px; right:-130px; width:400px; height:400px; border-radius:9999px; background:radial-gradient(closest-side, ${hexARgba(acTexto, 0.24)}, transparent);"></div>
                <div style="position:absolute; inset:0; ${estiloPuntos('rgba(255,255,255,0.05)', 1.2, 14)}"></div>
                ${destelloQR(acTexto, 56, 'top:34px; right:42px;')}
                ${destelloQR('#ffffff', 16, 'top:70px; left:46px;', 0.45)}
                ${destelloQR(acTexto, 20, 'bottom:78px; left:40px;', 0.8)}

                <div style="position:relative; z-index:2; background:#ffffff; border-radius:30px; padding:16px; box-shadow:7px 7px 0 0 ${acTexto};">
                    <div style="position:relative; padding:6px;">
                        ${esquinas}
                        <img src="${qr}" crossorigin="anonymous" style="width:168px; height:168px; border-radius:10px; display:block;" />
                    </div>
                </div>

                <div style="position:relative; z-index:2; margin-top:26px; background:${acTexto}; color:${NEGRO_DROPEA}; border-radius:9999px; padding:7px 16px; font-size:11px; font-weight:800; letter-spacing:0.22em; text-transform:uppercase; white-space:nowrap;">Volvé a pedir</div>
                <div style="position:relative; z-index:2; margin-top:12px; width:100%; color:#ffffff; font-size:${tam}px; ${ESTILO_NOMBRE_QR}">${nombreSeguro}</div>

                <div style="position:absolute; z-index:2; left:0; right:0; bottom:26px; display:flex; align-items:center; justify-content:center; gap:10px;">
                    <span style="color:#a1a1aa; font-size:10px; font-weight:800; letter-spacing:0.22em; text-transform:uppercase; white-space:nowrap;">Escaneá el código</span>
                    <span style="width:4px; height:4px; border-radius:9999px; background:${acTexto};"></span>
                    ${logoDropeaHtml(dropea, true, 16)}
                </div>
            </div>`;
    }

    // story
    const tam = tamanoNombreQR(nombre, 26);
    return `
        <div style="width:405px; height:720px; position:relative; overflow:hidden; display:flex; flex-direction:column; align-items:center; justify-content:space-between; padding:56px 36px 52px; text-align:center; background:${NEGRO_DROPEA}; ${estiloFuente}">
            <div style="position:absolute; top:-170px; right:-150px; width:440px; height:440px; border-radius:9999px; background:radial-gradient(closest-side, ${hexARgba(acTexto, 0.24)}, transparent);"></div>
            <div style="position:absolute; bottom:-200px; left:-170px; width:420px; height:420px; border-radius:9999px; background:radial-gradient(closest-side, ${hexARgba(acTexto, 0.10)}, transparent);"></div>
            <div style="position:absolute; inset:0; ${estiloPuntos('rgba(255,255,255,0.045)', 1.2, 15)}"></div>
            ${destelloQR(acTexto, 50, 'top:150px; right:30px;')}
            ${destelloQR('#ffffff', 16, 'top:236px; left:34px;', 0.45)}
            ${destelloQR(acTexto, 20, 'bottom:64px; right:40px;', 0.8)}

            <div style="position:relative; z-index:2;">${logoDropeaHtml(dropea, true, 38)}</div>

            <!-- Título en tres líneas fijas y cortas: cada línea es su propio bloque
                 (no depende de que el ancho/tamaño de fuente "adivine" el salto),
                 así nunca se parte en otra línea que pise el QR de más abajo. -->
            <div style="position:relative; z-index:2; font-weight:800; font-style:italic; text-transform:uppercase; letter-spacing:-0.02em; line-height:1.02; font-size:35px;">
                <div style="color:#ffffff; white-space:nowrap;">¡Ya tenemos</div>
                <div style="color:${acTexto}; white-space:nowrap;">catálogo</div>
                <div style="color:#ffffff; white-space:nowrap;">online!</div>
            </div>

            <div style="position:relative; z-index:2; background:#ffffff; border-radius:34px; padding:18px; box-shadow:8px 8px 0 0 ${acTexto};">
                <div style="position:relative; padding:6px;">
                    ${esquinas}
                    <img src="${qr}" crossorigin="anonymous" style="width:180px; height:180px; border-radius:10px; display:block;" />
                </div>
            </div>

            <div style="position:relative; z-index:2; width:100%; color:#ffffff; font-size:${tam}px; ${ESTILO_NOMBRE_QR}">${nombreSeguro}</div>

            <div style="position:relative; z-index:2; border:2px solid ${acTexto}; color:${acTexto}; border-radius:9999px; padding:8px 18px; font-size:10.5px; font-weight:800; letter-spacing:0.2em; text-transform:uppercase; white-space:nowrap; max-width:100%;">${host}</div>
        </div>`;
}

// Arma (una sola vez) los selectores de paleta y tipografía, y refresca cuál
// está marcada como activa. Se llama en cada render porque es muy barato y
// así queda simple mantener el estado sincronizado.
function renderSelectoresQR() {
    const filaPaleta = document.getElementById('qr-paleta-row');
    if (filaPaleta && !filaPaleta.dataset.armada) {
        filaPaleta.innerHTML = Object.entries(PALETAS_QR).map(([key, p]) => `
            <button type="button" id="qr-color-${key}" class="qr-color-swatch" style="background:${p.acento};"
                title="${p.label}" aria-label="Paleta ${p.label}" onclick="seleccionarPaletaQR('${key}')"></button>
        `).join('');
        filaPaleta.dataset.armada = '1';
    }

    const listaFuentes = document.getElementById('qr-fuente-lista');
    if (listaFuentes && !listaFuentes.dataset.armada) {
        listaFuentes.innerHTML = Object.entries(FUENTES_QR).map(([key, f]) => `
            <button type="button" id="qr-fuente-${key}" class="qr-fuente-opcion" onclick="seleccionarFuenteQR('${key}')">
                <span class="qr-fuente-preview" style="font-family:${f.family};">Aa</span>
                <span class="qr-fuente-nombre">${f.label}</span>
                <span class="qr-fuente-check">✓</span>
            </button>
        `).join('');
        listaFuentes.dataset.armada = '1';
    }

    Object.keys(PALETAS_QR).forEach(key => {
        const el = document.getElementById(`qr-color-${key}`);
        if (el) el.classList.toggle('qr-color-activa', key === paletaQRActiva);
    });
    Object.keys(FUENTES_QR).forEach(key => {
        const el = document.getElementById(`qr-fuente-${key}`);
        if (el) el.classList.toggle('qr-fuente-activa', key === fuenteQRActiva);
    });

    // Sincroniza los botones "Color" y "Tipografía" de la fila inferior
    // (el punto de color y la "Aa" muestran siempre la selección actual).
    const dotColor = document.getElementById('qr-trigger-color-dot');
    if (dotColor) dotColor.style.background = PALETAS_QR[paletaQRActiva].acento;

    const aaFuente = document.getElementById('qr-trigger-fuente-aa');
    if (aaFuente) aaFuente.style.fontFamily = FUENTES_QR[fuenteQRActiva].family;
}

// ============================================================
// PANELES DE "Color" y "Tipografía": dropdown que se ubica con
// position:fixed en coordenadas de PANTALLA (no del documento), calculado
// por JS cada vez que se abre. Con esto:
//  - Nunca queda cortado arriba de la pantalla: si no entra hacia arriba,
//    se abre hacia abajo automáticamente.
//  - No modifica el alto scrolleable de la página al abrir/cerrar, así
//    que seleccionar una opción no hace saltar el scroll.
// Los paneles se mueven una sola vez a <body> porque la sección donde
// viven tiene una animación con "transform", y eso rompe position:fixed
// (lo vuelve relativo a esa sección en vez de a la pantalla).
// ============================================================
function moverPanelesQRaBody() {
    ['color', 'fuente'].forEach(tipo => {
        const panel = document.getElementById(`panel-qr-${tipo}`);
        if (panel && panel.parentElement !== document.body) {
            document.body.appendChild(panel);
        }
    });
}

function toggleQRPanel(tipo) {
    const panel = document.getElementById(`panel-qr-${tipo}`);
    if (!panel) return;
    const abierto = !panel.classList.contains('hidden');
    cerrarPanelQR('color');
    cerrarPanelQR('fuente');
    if (!abierto) abrirPanelQR(tipo);
}

function abrirPanelQR(tipo) {
    const btn = document.getElementById(`qr-btn-${tipo}`);
    const panel = document.getElementById(`panel-qr-${tipo}`);
    if (!btn || !panel) return;
    moverPanelesQRaBody();
    // Se posiciona con visibility:hidden primero para poder medir su
    // tamaño real sin que se vea "saltar" de un lugar a otro.
    panel.style.visibility = 'hidden';
    panel.classList.remove('hidden');
    posicionarPanelQR(btn, panel);
    panel.style.visibility = '';
    const chevron = document.getElementById(`chevron-qr-${tipo}`);
    if (chevron) chevron.classList.add('rotate-180');
}

function cerrarPanelQR(tipo) {
    const panel = document.getElementById(`panel-qr-${tipo}`);
    if (panel) panel.classList.add('hidden');
    const chevron = document.getElementById(`chevron-qr-${tipo}`);
    if (chevron) chevron.classList.remove('rotate-180');
}

// Calcula la posición del panel en coordenadas de pantalla a partir del
// botón que lo abrió. Preferimos abrir hacia arriba (pedido explícito),
// pero si no hay suficiente espacio libre arriba del botón, lo abrimos
// hacia abajo para que nunca quede cortado por el borde de la pantalla.
function posicionarPanelQR(btn, panel) {
    const margen = 12;
    const separacion = 8;
    const rectBtn = btn.getBoundingClientRect();

    const anchoPanel = Math.min(panel.offsetWidth || 304, window.innerWidth - margen * 2);
    let left = rectBtn.left;
    if (left + anchoPanel > window.innerWidth - margen) left = window.innerWidth - margen - anchoPanel;
    if (left < margen) left = margen;

    const espacioArriba = rectBtn.top - margen;
    const espacioAbajo = window.innerHeight - rectBtn.bottom - margen;
    const altoPanel = panel.scrollHeight || panel.offsetHeight || 0;

    const abrirHaciaArriba = espacioArriba >= Math.min(altoPanel, 200) || espacioArriba >= espacioAbajo;
    const espacioDisponible = Math.max(120, abrirHaciaArriba ? espacioArriba : espacioAbajo);
    const altoFinal = Math.min(altoPanel, espacioDisponible);

    const top = abrirHaciaArriba
        ? Math.max(margen, rectBtn.top - altoFinal - separacion)
        : rectBtn.bottom + separacion;

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${espacioDisponible}px`;
}

// Cerrar al hacer clic afuera (el botón y el panel viven en <body> ahora,
// pero closest() por id sigue funcionando sin importar dónde estén).
document.addEventListener('click', (e) => {
    ['color', 'fuente'].forEach(tipo => {
        if (!e.target.closest(`#qr-btn-${tipo}`) && !e.target.closest(`#panel-qr-${tipo}`)) {
            cerrarPanelQR(tipo);
        }
    });
});

// Al hacer scroll de la PÁGINA (el fondo), la posición calculada del panel
// deja de ser válida: lo más simple y predecible es cerrarlo. Pero hay que
// ignorar el scroll que pasa DENTRO del propio panel (la lista de paleta o
// de tipografías puede necesitar scroll interno) — si no, cualquier intento
// de scrollear esa lista cerraba el panel al toque.
window.addEventListener('scroll', (e) => {
    const vieneDeAdentro = e.target && e.target.closest &&
        (e.target.closest('#panel-qr-color') || e.target.closest('#panel-qr-fuente'));
    if (vieneDeAdentro) return;
    cerrarPanelQR('color');
    cerrarPanelQR('fuente');
}, true);

window.addEventListener('resize', () => {
    cerrarPanelQR('color');
    cerrarPanelQR('fuente');
});

function seleccionarPaletaQR(key) {
    paletaQRActiva = key;
    renderFormatoQR(formatoQRActivo);
    cerrarPanelQR('color');
}

function seleccionarFuenteQR(key) {
    fuenteQRActiva = key;
    renderFormatoQR(formatoQRActivo);
    cerrarPanelQR('fuente');
}

async function renderFormatoQR(formato) {
    formatoQRActivo = formato;

    // Resaltar el tile de formato elegido
    Object.keys(FORMATOS_QR).forEach(key => {
        const tile = document.getElementById(`qr-tile-${key}`);
        if (tile) tile.classList.toggle('qr-tile-activo', key === formato);
    });

    renderSelectoresQR();

    const contenedor = document.getElementById('qr-preview-stage');
    if (!contenedor) return; // la sección QR no está montada/visible todavía

    const cfg = FORMATOS_QR[formato];
    contenedor.innerHTML = `<div class="flex items-center justify-center py-16 text-slate-400 text-xs font-bold">Generando vista previa…</div>`;

    let qr;
    try {
        qr = await generarQRDataUrl();
    } catch (err) {
        console.error('Error generando el QR:', err);
        contenedor.innerHTML = `<div class="flex items-center justify-center py-16 text-red-500 text-xs font-bold text-center px-6">No se pudo generar el QR. Recargá la página e intentá de nuevo.</div>`;
        return;
    }
    const nombre = (emprendedorActual && emprendedorActual.nombre_tienda) || perfilActual.usuario;
    const logoOriginal = emprendedorActual && emprendedorActual.logo_url;
    const logoUrl = logoOriginal ? miniaturaCloudinary(logoOriginal, 160) : '';
    const dropea = await cargarLogoDropea();
    // Se muestra como texto en el cartel (ej. "dropea.com.ar"). Usa
    // SITIO_PUBLICO en vez de window.location.hostname porque este panel puede
    // vivir en un dominio distinto (Vercel) al del sitio público (Cloudflare).
    const host = SITIO_PUBLICO.replace(/^https?:\/\//, '');
    const paleta = PALETAS_QR[paletaQRActiva];
    const fuente = FUENTES_QR[fuenteQRActiva];

    const html = construirTarjetaHTML(formato, { nombre, logoUrl, qr, host, paleta, fuente, dropea });

    // Escala de la vista previa para que entre en el stage sin importar el tamaño real.
    // El stage tiene un alto FIJO (ver dashboard.html: h-[420px] sm:h-[480px]) para que
    // el contenedor nunca cambie de tamaño al cambiar de formato — si cambiara, todo lo
    // de abajo (color/tipografía/guardar) se correría y daba la sensación de que la
    // página "saltaba" o hacía scroll solo. Acá medimos el ancho/alto REALES ya
    // descontando el padding, así siempre calza dentro de esa misma caja fija.
    const estilos = getComputedStyle(contenedor);
    const padX = parseFloat(estilos.paddingLeft) + parseFloat(estilos.paddingRight);
    const padY = parseFloat(estilos.paddingTop) + parseFloat(estilos.paddingBottom);
    const anchoDisponible = (contenedor.clientWidth || 320) - padX;
    const altoDisponible = (contenedor.clientHeight || 420) - padY;
    const escala = Math.min(anchoDisponible / cfg.ancho, altoDisponible / cfg.alto, 0.9);

    contenedor.innerHTML = `
        <div style="width:${cfg.ancho * escala}px; height:${cfg.alto * escala}px;" class="mx-auto overflow-hidden rounded-2xl shadow-xl border border-slate-200">
            <div id="qr-tarjeta-real" style="width:${cfg.ancho}px; height:${cfg.alto}px; transform:scale(${escala}); transform-origin: top left;">
                ${html}
            </div>
        </div>`;
}

// true solo en celular/tablet real (no en desktop, aunque el navegador
// exponga navigator.share como Edge o Chrome en Windows, o aunque la PC
// tenga pantalla táctil / trackpad que el navegador reporte como "coarse").
// Nos basamos únicamente en el userAgent: es la única señal que distingue
// de forma confiable un dispositivo mobile real de una PC con touch/trackpad,
// que es justamente el caso que hacía aparecer el share sheet en desktop.
function esMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function descargarTarjetaQR() {
    const btn = document.getElementById('btn-descargar-qr');
    const label = document.getElementById('qr-btn-guardar-label');
    const textoOriginal = label.textContent;
    btn.disabled = true;
    label.textContent = 'Generando…';

    try {
        const nodo = document.getElementById('qr-tarjeta-real');

        // html-to-image copia los tamaños ya calculados en pantalla (ancho de cada
        // caja) al clon. Si la fuente que se dibuja al exportar es distinta de la que
        // se ve en pantalla (fuente de reemplazo más ancha), el texto no entra en esas
        // cajas y se parte/pisa. Por eso primero forzamos la carga real de la fuente
        // elegida (incluido el peso 800 cursivo de los títulos)...
        const familia = FUENTES_QR[fuenteQRActiva].family;
        if (document.fonts && document.fonts.load) {
            await Promise.all([
                `italic 800 24px ${familia}`,
                `800 24px ${familia}`,
                `400 24px ${familia}`,
            ].map(f => document.fonts.load(f).catch(() => null)));
            await document.fonts.ready;
        }

        const opciones = {
            pixelRatio: 3,
            backgroundColor: '#ffffff',
            style: { transform: 'none' },
            cacheBust: true,
        };

        // ...la incrustamos una sola vez en el SVG de exportación...
        try {
            opciones.fontEmbedCSS = await htmlToImage.getFontEmbedCSS(nodo, opciones);
        } catch (err) {
            console.warn('No se pudo precalcular el CSS de fuentes:', err);
        }

        // ...y hacemos una pasada de "calentamiento" descartable: en la primera
        // rasterización el navegador suele dibujar con la fuente de reemplazo porque
        // la incrustada todavía se está decodificando; la segunda ya sale correcta.
        await htmlToImage.toPng(nodo, { ...opciones, pixelRatio: 1 });
        const dataUrl = await htmlToImage.toPng(nodo, opciones);

        const slug = (perfilActual.usuario || 'tienda').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const nombreArchivo = `${FORMATOS_QR[formatoQRActivo].archivo}-${slug}.png`;

        // En mobile (sobre todo iOS Safari) el <a download> no sirve como "forzar
        // descarga": al llegar acá ya pasamos por dos await (fonts.ready y
        // htmlToImage.toPng), así que el click() ya no cuenta como gesto directo
        // del usuario, y Safari nunca soportó bien 'download' con data URLs de
        // todos modos — en vez de guardar, abre la imagen en una pestaña nueva.
        // Por eso en mobile usamos Web Share API: dispara la hoja nativa de
        // compartir/guardar, que es el flujo que sí funciona ahí. En desktop
        // seguimos con el <a download> de toda la vida.
        const blob = await (await fetch(dataUrl)).blob();
        const archivo = new File([blob], nombreArchivo, { type: 'image/png' });

        if (esMobile() && navigator.canShare && navigator.canShare({ files: [archivo] })) {
            await navigator.share({
                files: [archivo],
                title: FORMATOS_QR[formatoQRActivo].label + ' · Dropea',
            });
            mostrarToast('¡Listo! Guardala desde el panel para compartir.', 'success');
        } else {
            const link = document.createElement('a');
            link.download = nombreArchivo;
            link.href = dataUrl;
            document.body.appendChild(link);
            link.click();
            link.remove();
            mostrarToast('Imagen descargada. ¡Lista para imprimir o compartir!', 'success');
        }
    } catch (err) {
        // Si el usuario cancela el panel de compartir (navigator.share) no es un
        // error real, así que no mostramos el toast de "algo salió mal".
        if (err.name !== 'AbortError') {
            console.error('Error generando la tarjeta QR:', err);
            mostrarToast('No se pudo generar la imagen. Probá de nuevo.', 'error');
        }
    } finally {
        btn.disabled = false;
        label.textContent = textoOriginal;
    }
}
