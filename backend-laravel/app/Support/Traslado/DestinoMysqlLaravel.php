<?php

namespace App\Support\Traslado;

/** Destinos exclusivos: base definitiva y nombres históricos de pruebas desechables. */
final class DestinoMysqlLaravel
{
    /** Inventario de las migraciones Laravel; ampliar explícitamente al añadir tablas. */
    private const TABLAS = [
        'migrations', 'users', 'password_reset_tokens', 'sessions', 'cache', 'cache_locks',
        'jobs', 'job_batches', 'failed_jobs', 'estudiantes', 'cursos', 'ediciones',
        'matriculas', 'matricula_movimientos', 'catalogo_cursos', 'catalogo_servicios',
        'preguntas_frecuentes', 'galeria_items', 'convenios', 'convenio_fotos', 'ajustes_publicos',
        'importaciones_academicas', 'importacion_academica_filas',
    ];

    public static function nombrePermitido(string $base): bool
    {
        return preg_match('/^(?:horus_group|horus_laravel_it_[a-f0-9]{16})$/D', $base) === 1;
    }

    /**
     * @param  list<string>  $tablas
     * @return list<string>
     */
    public static function tablasAjenas(array $tablas): array
    {
        return array_values(array_diff($tablas, self::TABLAS));
    }
}
