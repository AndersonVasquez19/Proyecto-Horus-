<x-filament-widgets::widget class="horus-panel horus-estados">
    <x-filament::section>
        <x-slot name="heading">Matrículas por estado</x-slot>

        <x-slot name="description">
            @if ($total > 0)
                {{ $total }} {{ $total === 1 ? 'matrícula registrada' : 'matrículas registradas' }} en total
            @else
                Distribución de las matrículas registradas
            @endif
        </x-slot>

        <x-slot name="afterHeader">
            <a href="{{ $urlMatriculas }}" class="horus-enlace">Ver matrículas</a>
        </x-slot>

        @if ($total === 0)
            <div class="horus-vacio">
                {{ \Filament\Support\generate_icon_html(\Filament\Support\Icons\Heroicon::OutlinedChartBar, attributes: (new \Filament\Support\View\ComponentAttributeBag)->class(['horus-vacio-icono'])) }}
                <p class="horus-vacio-titulo">Sin matrículas</p>
                <p class="horus-vacio-texto">Aún no hay matrículas. Cuando registre la primera, verá aquí su distribución.</p>
            </div>
        @else
            {{-- Barra decorativa: los mismos datos se leen como texto en la leyenda. --}}
            <div class="horus-barra" aria-hidden="true">
                @foreach ($estados as $estado)
                    @if ($estado['cantidad'] > 0)
                        <span
                            class="horus-barra-tramo horus-tono-{{ $estado['tono'] }}"
                            style="flex-grow: {{ $estado['cantidad'] }}"
                        ></span>
                    @endif
                @endforeach
            </div>

            <ul class="horus-leyenda">
                @foreach ($estados as $estado)
                    <li class="horus-leyenda-item">
                        <span class="horus-leyenda-punto horus-tono-{{ $estado['tono'] }}" aria-hidden="true"></span>
                        <span class="horus-leyenda-cuerpo">
                            <span class="horus-leyenda-cabecera">
                                <span class="horus-leyenda-etiqueta">{{ $estado['etiqueta'] }}</span>
                                <span class="horus-leyenda-cantidad">{{ $estado['cantidad'] }}</span>
                            </span>
                            <span class="horus-leyenda-porcentaje">{{ str_replace('.', ',', (string) $estado['porcentaje']) }} %</span>
                            <span class="horus-leyenda-descripcion">{{ $estado['descripcion'] }}</span>
                        </span>
                    </li>
                @endforeach
            </ul>
        @endif
    </x-filament::section>
</x-filament-widgets::widget>
