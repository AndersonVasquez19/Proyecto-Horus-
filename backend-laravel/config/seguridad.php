<?php

return [
    // Preparación únicamente: el local existente mantiene /admin hasta la
    // transición expresamente autorizada. Fuera de local no existe bypass.
    'activar_en_local' => env('HORUS_SEGURIDAD_ACTIVA', false),
];
