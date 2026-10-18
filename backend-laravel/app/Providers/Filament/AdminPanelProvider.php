<?php

namespace App\Providers\Filament;

use App\Filament\AvatarProviders\Iniciales;
use App\Filament\Pages\Dashboard;
use App\Http\Middleware\EstablecerIdiomaPanel;
use App\Support\SeguridadPanel;
use Filament\Enums\ThemeMode;
use Filament\Http\Middleware\Authenticate;
use Filament\Http\Middleware\AuthenticateSession;
use Filament\Http\Middleware\DisableBladeIconComponents;
use Filament\Http\Middleware\DispatchServingFilamentEvent;
use Filament\Panel;
use Filament\PanelProvider;
use Filament\Support\Assets\Css;
use Filament\Support\Colors\Color;
use Filament\Support\Facades\FilamentAsset;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\View\Middleware\ShareErrorsFromSession;

class AdminPanelProvider extends PanelProvider
{
    public function panel(Panel $panel): Panel
    {
        // Tema «Horus Academic» (Fase 1): CSS estático publicado con `php artisan filament:assets`
        // desde resources/css/horus-academic.css a public/css/app/horus-academic.css.
        // La fecha del archivo publicado sirve de versión para que el navegador no use una copia vieja.
        $temaPublicado = public_path('css/app/horus-academic.css');
        FilamentAsset::appVersion(is_file($temaPublicado) ? (string) filemtime($temaPublicado) : null);

        // Escala del azul principal con #2554EB como tono 600 y #1D3FCC como 700. Filament pinta
        // los botones con el 600 (hover 500) y texto blanco solo si ambos llegan a contraste AA;
        // la escala que genera Color::hex() los deja demasiado claros y los botones salían
        // celestes con texto oscuro. Contraste con blanco: 500 ≈ 4,7:1; 600 ≈ 6,0:1; 700 ≈ 8,1:1.
        $azul = array_replace(Color::hex('#2554EB'), [
            500 => Color::convertToOklch('#3D68F0'),
            600 => Color::convertToOklch('#2554EB'),
            700 => Color::convertToOklch('#1D3FCC'),
        ]);

        return $panel
            ->default()
            ->id('admin')
            ->path(SeguridadPanel::ruta())
            ->strictAuthorization(SeguridadPanel::activa())
            ->login()
            ->brandName('Horus Group')
            ->brandLogo(fn () => view('filament.marca'))
            ->brandLogoHeight('2.5rem')
            ->favicon(fn (): string => asset('images/horus/logo-horus.png'))
            // Tema claro únicamente: el diseño Horus Academic no tiene variante oscura todavía.
            ->defaultThemeMode(ThemeMode::Light)
            ->darkMode(false)
            // Avatar de iniciales generado en local (sin ui-avatars.com ni Internet).
            ->defaultAvatarProvider(Iniciales::class)
            ->sidebarWidth('17rem')
            ->colors([
                // Paleta Horus Academic. El navy institucional #0a2540 queda para la marca.
                'primary' => $azul,
                'info' => $azul,
                'success' => Color::hex('#12A67A'),
                'warning' => Color::hex('#E8A317'),
                'danger' => Color::hex('#E5484D'),
                'gray' => Color::Slate,
            ])
            ->assets([
                Css::make('horus-academic', resource_path('css/horus-academic.css')),
            ])
            ->navigationGroups([
                'Gestión académica',
                // Solo visible con el contenido público habilitado y un rol autorizado.
                'Contenido web',
            ])
            ->discoverResources(in: app_path('Filament/Resources'), for: 'App\Filament\Resources')
            ->discoverPages(in: app_path('Filament/Pages'), for: 'App\Filament\Pages')
            ->pages([
                Dashboard::class,
            ])
            // Solo widgets propios con datos reales (app/Filament/Widgets).
            ->discoverWidgets(in: app_path('Filament/Widgets'), for: 'App\Filament\Widgets')
            ->middleware([
                EncryptCookies::class,
                AddQueuedCookiesToResponse::class,
                StartSession::class,
                AuthenticateSession::class,
                ShareErrorsFromSession::class,
                PreventRequestForgery::class,
                SubstituteBindings::class,
                DisableBladeIconComponents::class,
                DispatchServingFilamentEvent::class,
            ])
            // Persistente: también se aplica a las peticiones de Livewire.
            ->middleware([
                EstablecerIdiomaPanel::class,
            ], isPersistent: true)
            ->authMiddleware([
                Authenticate::class,
            ], isPersistent: true);
    }
}
