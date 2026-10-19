<?php

namespace App\Filament\Concerns;

/**
 * Páginas de creación y edición del contenido público: los errores del modelo
 * aparecen junto a su campo y un slug duplicado concurrente no produce un 500.
 */
trait PaginaDeContenido
{
    use TraduceErroresDeDominio;

    protected function campoErrorDeUnicidad(): string
    {
        return 'slug';
    }

    protected function mensajeErrorDeUnicidad(): string
    {
        return 'Ya existe otro registro con este identificador.';
    }
}
