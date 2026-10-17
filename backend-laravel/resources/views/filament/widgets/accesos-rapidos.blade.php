<x-filament-widgets::widget class="horus-panel horus-accesos">
    <x-filament::section>
        <x-slot name="heading">Accesos rápidos</x-slot>

        <x-slot name="description">Registre información académica en un paso</x-slot>

        @if (count($accesos) === 0)
            <p class="horus-vacio-texto">No tiene permisos para registrar información nueva.</p>
        @else
            <ul class="horus-accesos-lista">
                @foreach ($accesos as $acceso)
                    <li>
                        <a href="{{ $acceso['url'] }}" class="horus-acceso">
                            <span class="horus-burbuja horus-tono-{{ $acceso['tono'] }}" aria-hidden="true">
                                {{ \Filament\Support\generate_icon_html($acceso['icono']) }}
                            </span>
                            <span class="horus-acceso-texto">
                                <span class="horus-acceso-titulo">{{ $acceso['titulo'] }}</span>
                                <span class="horus-acceso-descripcion">{{ $acceso['descripcion'] }}</span>
                            </span>
                            {{ \Filament\Support\generate_icon_html(\Filament\Support\Icons\Heroicon::OutlinedChevronRight, attributes: (new \Filament\Support\View\ComponentAttributeBag)->class(['horus-acceso-flecha'])) }}
                        </a>
                    </li>
                @endforeach
            </ul>
        @endif
    </x-filament::section>
</x-filament-widgets::widget>
