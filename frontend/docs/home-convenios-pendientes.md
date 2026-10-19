# Home: bienvenida y convenios

## Referencia visual antigua

Se revisaron index.html, assets/css/index/animation.css, assets/js/pantalla-inicio.js, assets/css/index/convenios-estrategicos.css, assets/css/index/convenios-carousel.css y assets/js/convenios-carousel.js de la carpeta original.

La bienvenida antigua tenía fondo negro, aro dorado, logo y saludo. Bloqueaba scroll y añadía 3000 ms tras window.load y 500 ms de salida. HomeWelcome conserva la identidad con 650 ms desde montaje (400 ms estáticos con movimiento reducido), sin esperar imágenes/API ni bloquear scroll, foco o navegación. Aparece solo al entrar inicialmente por Home; navegación interna no la repite. Su implementación previamente aprobada se conserva.

Los convenios antiguos cambiaban la presentación central al hacer clic, mostrando una foto, nombre y descripción; en móvil usaban overlay inferior. El segundo carrusel del JS no tenía los selectores correspondientes en index.html. Había asociaciones dudosas: Enfermeros reutilizaba Administración e ISAM reutilizaba Economistas. No se importan esos textos ni fotografías.

## Implementación actual

Home consume convenios visibles del backend, sin CONVENIOS local ni fallback estático. La misma lista paginada alimenta la estadística mediante pagination.total. Se conserva el fondo azul oscuro, detalles dorados, logo institucional y tarjetas de alianzas.

HomeConvenioDialog muestra datos completos administrables y fotografías independientes de la Galería pública. Resuelve carga, error/reintento, ocultación/eliminación mientras está abierto y descripción corta como alternativa al texto completo. Admite teclado, Escape, clic exterior, retorno de foco y movimiento reducido.

HomeConvenioGallery admite ninguna, una o varias fotografías, controles, teclado y swipe. ImageUpload conserva su uso de imagen única y habilita selección múltiple solo al solicitarla. Los estilos públicos están limitados a Home; el panel conserva su diseño.

## Pendiente de activación

Los modelos, API y panel están implementados y probados. La migración de la base principal y la importación de los cinco registros siguen pendientes de revisión/autorización. No se requieren campos adicionales de backend para el detalle aprobado. No se inventaron descripciones completas, información adicional ni fotos.

Consulta [documentación de Convenios](../../backend/CONVENIOS.md) para endpoints, archivos, procedimiento manual y vista previa exacta.
