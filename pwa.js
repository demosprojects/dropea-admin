// ============================================================
// PWA - Registro de Service Worker + splash screen
// Dropea
// ============================================================
(function () {

    // --------------------------------------------------------
    // 1) SERVICE WORKER: registro y detección de actualizaciones
    // --------------------------------------------------------
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
                .then((reg) => {
                    // Si ya había una actualización instalada y esperando de una
                    // sesión anterior (ej. cerraste la app sin tocar "Actualizar"),
                    // la mostramos de nuevo apenas carga la página.
                    if (reg.waiting) mostrarAvisoActualizacion(reg);

                    // Chequeo periódico de actualizaciones (cada 60s) y al volver
                    // a la pestaña, para detectar deploys nuevos en Vercel rápido.
                    setInterval(() => reg.update(), 60 * 1000);
                    document.addEventListener('visibilitychange', () => {
                        if (document.visibilityState === 'visible') reg.update();
                    });

                    reg.addEventListener('updatefound', () => {
                        const nuevoWorker = reg.installing;
                        if (!nuevoWorker) return;
                        nuevoWorker.addEventListener('statechange', () => {
                            // "installed" + ya había un controller = es una ACTUALIZACIÓN
                            // (no la primera instalación).
                            if (nuevoWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                mostrarAvisoActualizacion(reg);
                            }
                        });
                    });
                })
                .catch((err) => console.error('[PWA] Error registrando el Service Worker:', err));

            // Cuando el nuevo SW toma control, recargamos una sola vez para
            // que el usuario vea la versión más reciente.
            let recargando = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (recargando) return;
                recargando = true;
                window.location.reload();
            });
        });
    }

    function mostrarAvisoActualizacion(reg) {
        if (!reg.waiting) return;
        if (document.querySelector('.pwa-update-overlay')) return;

        const overlay = document.createElement('div');
        overlay.className = 'pwa-update-overlay';
        overlay.innerHTML =
            '<div class="pwa-update-sheet" role="dialog" aria-modal="true" aria-labelledby="pwa-update-titulo">' +
                '<div class="pwa-update-sheet__handle"></div>' +
                '<div class="pwa-update-sheet__header">' +
                    '<div>' +
                        '<span class="pwa-update-sheet__brand">Dropea</span>' +
                        '<h2 id="pwa-update-titulo" class="pwa-update-sheet__title">Hay una nueva versión</h2>' +
                    '</div>' +
                    '<span class="pwa-update-sheet__icon">' +
                        '<img class="pwa-update-sheet__icon-img" src="favicon-96x96.png" alt="">' +
                        '<svg class="pwa-update-sheet__icon-fallback" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                            '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><polyline points="21 3 21 9 15 9"></polyline>' +
                        '</svg>' +
                        '<span class="pwa-update-sheet__icon-dot"></span>' +
                    '</span>' +
                '</div>' +
                '<div class="pwa-update-sheet__body">' +
                    '<p>Sumamos mejoras y correcciones para que Dropea funcione mejor.</p>' +
                    '<p>Actualizá para usar la última versión. Es rápido y <strong>no perdés nada</strong> de lo que tenías cargado.</p>' +
                '</div>' +
                '<button type="button" class="pwa-update-sheet__btn">' +
                    '<span class="pwa-update-sheet__spin"></span>' +
                    '<span class="pwa-update-sheet__btn-texto">Actualizar ahora</span>' +
                '</button>' +
            '</div>';
        document.body.appendChild(overlay);
        bloquearScrollFondo(overlay);

        // Si favicon-96x96.png no carga, mostramos el ícono de recarga
        // en su lugar en vez de dejar la imagen rota superpuesta con el SVG.
        const iconImg = overlay.querySelector('.pwa-update-sheet__icon-img');
        const iconFallback = overlay.querySelector('.pwa-update-sheet__icon-fallback');
        if (iconImg) {
            iconImg.addEventListener('error', () => {
                iconImg.remove();
                if (iconFallback) iconFallback.style.display = 'block';
            }, { once: true });
        }

        requestAnimationFrame(() => overlay.classList.add('pwa-update-overlay-show'));

        const worker = reg.waiting;
        const btnActualizar = overlay.querySelector('.pwa-update-sheet__btn');

        bloquearSalida(overlay, btnActualizar);
        btnActualizar.focus({ preventScroll: true });

        btnActualizar.addEventListener('click', () => {
            // Si el SW nuevo ya no sirve (quedó "redundant"), recargar trae el vigente
            if (worker.state === 'redundant') { window.location.reload(); return; }

            btnActualizar.disabled = true;
            overlay.querySelector('.pwa-update-sheet__spin').style.display = 'inline-block';
            overlay.querySelector('.pwa-update-sheet__btn-texto').textContent = 'Actualizando...';
            worker.postMessage({ type: 'SKIP_WAITING' });
            // No cerramos el sheet acá: el "controllerchange" en el registro
            // de arriba recarga la página solo apenas el SW nuevo toma control.

            // Si en 8 segundos no pasó nada, el botón vuelve a quedar disponible
            // para reintentar (el aviso sigue siendo la única opción).
            setTimeout(() => {
                btnActualizar.disabled = false;
                overlay.querySelector('.pwa-update-sheet__spin').style.display = 'none';
                overlay.querySelector('.pwa-update-sheet__btn-texto').textContent = 'Reintentar';
                btnActualizar.focus({ preventScroll: true });
            }, 8000);
        });
    }

    // El aviso es obligatorio: la ÚNICA salida es el botón "Actualizar".
    // - El resto de la página queda inerte (sin clics, foco ni teclado).
    // - Clics / toques / menú contextual fuera del botón se descartan.
    // - Escape no hace nada y Tab (o cualquier foco) vuelve siempre al botón.
    function bloquearSalida(overlay, boton) {
        Array.from(document.body.children).forEach((el) => {
            if (el === overlay) return;
            el.setAttribute('inert', '');
            el.setAttribute('aria-hidden', 'true');
        });

        ['click', 'dblclick', 'auxclick', 'contextmenu'].forEach((tipo) => {
            document.addEventListener(tipo, (ev) => {
                if (boton.contains(ev.target)) return;
                ev.preventDefault();
                ev.stopPropagation();
            }, true);
        });

        document.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); }
            else if (ev.key === 'Tab') { ev.preventDefault(); boton.focus({ preventScroll: true }); }
        }, true);

        document.addEventListener('focusin', (ev) => {
            if (!overlay.contains(ev.target)) boton.focus({ preventScroll: true });
        });
    }

    // Mientras el aviso está abierto, el fondo no debe poder scrollearse.
    // - Desktop / Android: la clase pwa-scroll-lock pone overflow:hidden en html y body (ver pwa.css).
    // - iOS / iPadOS: overflow:hidden no siempre frena el scroll con el dedo, así que además se
    //   cancelan los touchmove que arrancan fuera de la tarjeta (o dentro, si la tarjeta no scrollea).
    // No hace falta desbloquear: el aviso es obligatorio y solo se cierra recargando la página (controllerchange).
    function bloquearScrollFondo(overlay) {
        document.documentElement.classList.add('pwa-scroll-lock');
        document.body.classList.add('pwa-scroll-lock');

        const sheet = overlay.querySelector('.pwa-update-sheet');
        overlay.addEventListener('touchmove', (ev) => {
            const dentro = sheet && sheet.contains(ev.target);
            const scrollea = sheet && sheet.scrollHeight > sheet.clientHeight;
            if (!dentro || !scrollea) ev.preventDefault();
        }, { passive: false });
    }

    // --------------------------------------------------------
    // 2) INSTALAR APP: botón "Instalar app" en login.html
    //    - Chrome/Edge/Android: usamos el evento beforeinstallprompt,
    //      que el navegador dispara si la PWA cumple los requisitos
    //      (manifest + service worker + servida por https).
    //    - iOS/Safari: no existe ese evento, así que si detectamos iOS
    //      y la app no está ya instalada, mostramos el botón igual pero
    //      al tocarlo abrimos un modal con instrucciones manuales
    //      (Compartir → Agregar a inicio).
    //    - Si la app ya corre instalada (standalone), el botón queda oculto.
    // --------------------------------------------------------
    (function () {
        const bloqueInstalar = document.getElementById('bloque-instalar-app');
        const btnInstalar = document.getElementById('btn-install-app');
        if (!bloqueInstalar || !btnInstalar) return;

        const modalIOS = document.getElementById('modal-instalar-ios');
        const modalIOSOverlay = document.getElementById('modal-instalar-ios-overlay');
        const modalIOSCerrar = document.getElementById('modal-instalar-ios-cerrar');
        const modalIOSEntendido = document.getElementById('modal-instalar-ios-entendido');

        const esStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
        const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

        if (esStandalone) return; // ya instalada, no mostramos nada

        let promptDiferido = null;

        function mostrarBotonInstalar() {
            bloqueInstalar.classList.remove('hidden');
        }

        function ocultarBotonInstalar() {
            bloqueInstalar.classList.add('hidden');
        }

        function abrirModalIOS() {
            if (!modalIOS) return;
            modalIOS.classList.remove('hidden');
        }

        function cerrarModalIOS() {
            if (!modalIOS) return;
            modalIOS.classList.add('hidden');
        }

        if (modalIOSOverlay) modalIOSOverlay.addEventListener('click', cerrarModalIOS);
        if (modalIOSCerrar) modalIOSCerrar.addEventListener('click', cerrarModalIOS);
        if (modalIOSEntendido) modalIOSEntendido.addEventListener('click', cerrarModalIOS);

        // Chrome / Edge / Android: el navegador avisa que la PWA es instalable
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            promptDiferido = e;
            mostrarBotonInstalar();
        });

        // iOS Safari: no hay beforeinstallprompt, mostramos el botón directo
        // (solo si estamos en Safari, no en apps embebidas como Instagram/FB
        // donde "Agregar a inicio" no está disponible igual).
        if (esIOS) {
            mostrarBotonInstalar();
        }

        btnInstalar.addEventListener('click', async () => {
            if (promptDiferido) {
                promptDiferido.prompt();
                const resultado = await promptDiferido.userChoice;
                promptDiferido = null;
                if (resultado && resultado.outcome === 'accepted') {
                    ocultarBotonInstalar();
                }
                return;
            }

            if (esIOS) {
                abrirModalIOS();
                return;
            }

            // Otros navegadores sin soporte de instalación (ej. Firefox
            // desktop): no hay nada que ofrecer, así que ocultamos el botón.
            ocultarBotonInstalar();
        });

        // Se disparó una instalación exitosa (Chrome/Edge/Android)
        window.addEventListener('appinstalled', () => {
            promptDiferido = null;
            ocultarBotonInstalar();
            cerrarModalIOS();
        });
    })();

    // --------------------------------------------------------
    // 3) SPLASH SCREEN: solo visible cuando la app corre instalada
    //    (display-mode: standalone). Se oculta con fade una vez que
    //    la página terminó de cargar, respetando un tiempo mínimo
    //    para que no "parpadee" en conexiones rápidas.
    // --------------------------------------------------------
    const INICIO_SPLASH = Date.now();
    const SPLASH_MIN_MS = 550;

    function ocultarSplash() {
        const splash = document.querySelector('.pwa-splash');
        if (!splash) return;
        splash.classList.add('pwa-splash-hide');
        setTimeout(() => splash.remove(), 500);
    }

    function finalizarSplashCuandoListo() {
        const transcurrido = Date.now() - INICIO_SPLASH;
        const espera = Math.max(0, SPLASH_MIN_MS - transcurrido);
        setTimeout(ocultarSplash, espera);
    }

    if (document.readyState === 'complete') {
        finalizarSplashCuandoListo();
    } else {
        window.addEventListener('load', finalizarSplashCuandoListo);
    }
})();
