// ============================================================
// COMPRESIÓN Y SUBIDA DE IMÁGENES
// ============================================================
// Se usa "var"/"function" (no const/let a nivel de módulo con posible
// doble inclusión) por la misma razón que en supabase-client.js.
//
// REGLAS (fotos de producto -> Supabase Storage):
//  - Formatos aceptados: JPG, JPEG, PNG, WebP
//  - Máximo 3 MB antes de comprimir
//  - Se redimensiona automáticamente (máx 1600x1600 px)
//  - Se convierte a WebP, calidad ~75-80%
//  - Peso final objetivo: 100-300 KB
//  - Todo se comprime en el navegador antes de subir
//
// Logo y portada del emprendedor van a Cloudinary (mismo pipeline de
// compresión en el navegador antes de subir, con su propio tamaño máximo).
// ------------------------------------------------------------

const IMG_TIPOS_ACEPTADOS = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const IMG_MAX_MB_ORIGINAL = 3;
const IMG_MAX_LADO_DEFAULT = 1600;
const IMG_PESO_OBJETIVO_MAX = 300 * 1024; // 300 KB
const IMG_CALIDAD_INICIAL = 0.8;
const IMG_CALIDAD_MINIMA = 0.5;

// Miniatura para las cards de grilla (catálogo, panel del vendedor, tienda):
// se sube COMO ARCHIVO APARTE, no se pide redimensionada al vuelo, porque
// el bucket público de Supabase Storage no hace transformación de imágenes
// en el plan free (a diferencia de Cloudinary, donde sí existe
// miniaturaCloudinary()). La URL del thumb se guarda en la columna
// imagen_thumb_url de la fila del producto (ver dashboard.js); si esa
// columna está vacía (productos cargados antes de este cambio), la
// grilla cae directo a la imagen completa — no se "adivina" ningún
// nombre de archivo, así que nunca puede dar 404.
const IMG_THUMB_LADO = 400;
const IMG_THUMB_PESO_OBJETIVO_MAX = 60 * 1024; // 60 KB
const IMG_THUMB_SUFIJO = '-thumb';

const BUCKET_PRODUCTOS = 'productos-imagenes';

// Un año en segundos: los nombres de archivo incluyen timestamp + random,
// así que un archivo nunca se pisa a sí mismo -> es seguro cachearlo "para
// siempre" en el CDN y en el navegador (evita recargas de origen de más).
const STORAGE_CACHE_CONTROL = '31536000';

const CLOUDINARY_CLOUD_NAME = 'dbhuhzl2z';
const CLOUDINARY_UPLOAD_PRESET = 'imagenes';

// ------------------------------------------------------------
// VALIDACIÓN
// ------------------------------------------------------------
// Devuelve null si el archivo es válido, o un mensaje de error si no.
function validarImagenSeleccionada(file) {
    if (!file) return 'No se seleccionó ningún archivo.';
    if (!IMG_TIPOS_ACEPTADOS.includes(file.type)) {
        return 'Formato no admitido. Usá JPG, PNG o WebP.';
    }
    if (file.size > IMG_MAX_MB_ORIGINAL * 1024 * 1024) {
        return `La imagen pesa demasiado (máx ${IMG_MAX_MB_ORIGINAL} MB antes de comprimir).`;
    }
    return null;
}

// ------------------------------------------------------------
// COMPRESIÓN EN EL NAVEGADOR
// ------------------------------------------------------------
function cargarImagenDesdeArchivo(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
        img.src = url;
    });
}

function canvasABlobWebp(canvas, calidad) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) { reject(new Error('No se pudo generar la imagen comprimida.')); return; }
            resolve(blob);
        }, 'image/webp', calidad);
    });
}

// Redimensiona (si hace falta), convierte a WebP y ajusta la calidad de forma
// iterativa (80% -> 50%) hasta acercarse al peso objetivo. Devuelve un Blob.
// Recibe la imagen ya cargada (<img>) para poder generar varios tamaños
// (imagen completa + miniatura) sin decodificar el archivo original dos veces.
async function comprimirImagenCargada(img, maxLado, pesoObjetivo) {
    let { width, height } = img;
    if (width > maxLado || height > maxLado) {
        const escala = Math.min(maxLado / width, maxLado / height);
        width = Math.round(width * escala);
        height = Math.round(height * escala);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);

    let calidad = IMG_CALIDAD_INICIAL;
    let blob = await canvasABlobWebp(canvas, calidad);

    while (blob.size > pesoObjetivo && calidad > IMG_CALIDAD_MINIMA) {
        calidad = Math.round((calidad - 0.1) * 100) / 100;
        blob = await canvasABlobWebp(canvas, calidad);
    }

    return blob;
}

async function comprimirImagen(file, maxLado = IMG_MAX_LADO_DEFAULT) {
    const img = await cargarImagenDesdeArchivo(file);
    const blob = await comprimirImagenCargada(img, maxLado, IMG_PESO_OBJETIVO_MAX);
    URL.revokeObjectURL(img.src);
    return blob;
}

// Genera los dos tamaños de una foto de producto a partir del MISMO archivo
// origen: la imagen completa (para el modal de detalle) y una miniatura
// liviana (para las cards de grilla). Evita re-leer el archivo dos veces.
async function comprimirImagenProductoConThumb(file) {
    const img = await cargarImagenDesdeArchivo(file);
    const completa = await comprimirImagenCargada(img, IMG_MAX_LADO_DEFAULT, IMG_PESO_OBJETIVO_MAX);
    const thumb = await comprimirImagenCargada(img, IMG_THUMB_LADO, IMG_THUMB_PESO_OBJETIVO_MAX);
    URL.revokeObjectURL(img.src);
    return { completa, thumb };
}

// ------------------------------------------------------------
// SUPABASE STORAGE (fotos de producto)
// ------------------------------------------------------------
// Bucket requerido: "productos-imagenes" (público). Ver notas al pie del
// archivo para la configuración necesaria en el Dashboard de Supabase.
// Devuelve { url, thumbUrl }: thumbUrl puede ser null si falló la subida
// de la miniatura (no es crítico, ver más abajo) — quien llama a esta
// función debe guardar ambos valores en la fila del producto
// (imagen_url e imagen_thumb_url).
async function subirImagenProductoSupabase(file, emprendedorId) {
    const errorValidacion = validarImagenSeleccionada(file);
    if (errorValidacion) throw new Error(errorValidacion);

    const { completa, thumb } = await comprimirImagenProductoConThumb(file);
    const nombreBase = `${emprendedorId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nombreArchivo = `${nombreBase}.webp`;
    const nombreThumb = `${nombreBase}${IMG_THUMB_SUFIJO}.webp`;

    const { error } = await supabase.storage
        .from(BUCKET_PRODUCTOS)
        .upload(nombreArchivo, completa, { contentType: 'image/webp', upsert: false, cacheControl: STORAGE_CACHE_CONTROL });
    if (error) throw error;

    const url = supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(nombreArchivo).data.publicUrl;

    // El thumb es una optimización de bandwidth, no dato crítico: si falla
    // la subida no cortamos el flujo (la fila queda sin imagen_thumb_url,
    // y la grilla cae directo a la imagen completa), solo lo logueamos.
    const { error: errorThumb } = await supabase.storage
        .from(BUCKET_PRODUCTOS)
        .upload(nombreThumb, thumb, { contentType: 'image/webp', upsert: false, cacheControl: STORAGE_CACHE_CONTROL });
    if (errorThumb) {
        console.error('No se pudo subir la miniatura de la imagen:', errorThumb);
        return { url, thumbUrl: null };
    }

    const thumbUrl = supabase.storage.from(BUCKET_PRODUCTOS).getPublicUrl(nombreThumb).data.publicUrl;
    return { url, thumbUrl };
}

// Borra una o dos imágenes de producto del bucket a partir de sus URLs
// públicas (la completa y, si existe, su miniatura). Recibe las URLs
// explícitas en vez de derivarlas por nombre de archivo — así nunca
// intenta borrar (ni le erra a) un archivo que no sabemos que existe.
// No es crítico si falla (por eso no lanza error, solo loguea).
async function borrarImagenProductoSupabase(urlPublica, urlThumbPublica) {
    const marcador = `/${BUCKET_PRODUCTOS}/`;
    const aPath = (url) => {
        if (!url) return null;
        const idx = url.indexOf(marcador);
        return idx === -1 ? null : url.slice(idx + marcador.length); // null si no es de este bucket (ej: URL vieja externa)
    };

    const paths = [aPath(urlPublica), aPath(urlThumbPublica)].filter(Boolean);
    if (paths.length === 0) return;

    const { error } = await supabase.storage.from(BUCKET_PRODUCTOS).remove(paths);
    if (error) console.error('No se pudo borrar la imagen anterior del storage:', error);
}

// ------------------------------------------------------------
// CLOUDINARY (logo y portada del emprendedor)
// ------------------------------------------------------------
async function subirImagenCloudinary(file, maxLado = IMG_MAX_LADO_DEFAULT) {
    const errorValidacion = validarImagenSeleccionada(file);
    if (errorValidacion) throw new Error(errorValidacion);

    const blob = await comprimirImagen(file, maxLado);

    const formData = new FormData();
    formData.append('file', blob, 'imagen.webp');
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
        method: 'POST',
        body: formData
    });

    if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        throw new Error(errBody?.error?.message || 'Error subiendo la imagen a Cloudinary.');
    }

    const data = await resp.json();
    return data.secure_url;
}