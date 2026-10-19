<?php

return [
    // La ruta CSRF se registra junto con A1, nunca automáticamente en producción.
    'routes' => false,
    'guard' => ['web'],
];
