<?php

return [
    /*
     * Recursos de contenido público en /gestion. Desactivados por defecto; activarlos
     * requiere autorización (docs/contenido-publico.md). Aun activados, solo los gestiona
     * la administración general activa: RolUsuario::gestionaContenidoPublico().
     */
    'panel_habilitado' => env('HORUS_CONTENIDO_PANEL', false),

    /*
     * Endpoints públicos de solo lectura /api/contenido/*. Desactivados por defecto;
     * NestJS sigue siendo el proveedor del sitio mientras no se active expresamente.
     */
    'api_habilitada' => env('HORUS_CONTENIDO_API', false),

    'peticiones_por_minuto' => 120,
];
