<?php

namespace App\Http\Controllers;

use App\Enums\Contenido\CategoriaServicio;
use App\Models\AjustePublico;
use App\Models\CatalogoCurso;
use App\Models\CatalogoServicio;
use App\Models\Convenio;
use App\Models\GaleriaItem;
use App\Models\PreguntaFrecuente;
use App\Support\Contenido\PresentadorContenido;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * API pública de solo lectura del contenido institucional (/api/contenido/*).
 *
 * Contrato compatible con NestJS: listas { ok, items, pagination } y detalles
 * { ok, item }; 404 { ok: false, mensaje } y 400 ante parámetros inválidos o
 * desconocidos. Los parámetros nunca habilitan borradores, archivados ni ocultos.
 */
class ContenidoPublicoController extends Controller
{
    private const NO_ENCONTRADO = 'Contenido no encontrado.';

    /** Parámetros comunes del catálogo (mismos que CatalogoQueryDto de NestJS). */
    private const CATALOGO = ['periodo', 'tipo', 'modalidad', 'categoria', 'page', 'limit', 'search', 'estado'];

    public function cursos(Request $request): JsonResponse
    {
        return $this->responder(function () use ($request): JsonResponse {
            $q = $this->consulta($request, self::CATALOGO, [
                'periodo' => ['in:upcoming,unscheduled,past'],
                'tipo' => ['in:curso,capacitacion'],
                'modalidad' => ['in:presencial,virtual,hibrida'],
            ]);

            if ($q instanceof JsonResponse) {
                return $q;
            }

            $consulta = CatalogoCurso::query()->publicados()
                ->when($q['tipo'] ?? null, fn (Builder $b, string $v) => $b->where('tipo', $v))
                ->when($q['modalidad'] ?? null, fn (Builder $b, string $v) => $b->where('modalidad', $v))
                ->when($q['search'] ?? null, fn (Builder $b, string $v) => $this->contiene($b, 'titulo', $v));

            if (isset($q['periodo'])) {
                // «Hoy» en Perú, como NestJS.
                $hoy = now('America/Lima')->toDateString();
                match ($q['periodo']) {
                    'unscheduled' => $consulta->whereNull('fecha_inicio'),
                    'past' => $consulta->whereDate('fecha_inicio', '<', $hoy),
                    'upcoming' => $consulta->whereDate('fecha_inicio', '>=', $hoy),
                };
                $consulta->orderBy('fecha_inicio')->orderBy('id');
            } else {
                $consulta->orderBy('orden')->orderByDesc('id');
            }

            return $this->pagina($consulta, $q, PresentadorContenido::curso(...));
        });
    }

    public function curso(int $id): JsonResponse
    {
        return $this->detalle(CatalogoCurso::query()->publicados(), $id, PresentadorContenido::curso(...));
    }

    public function servicios(Request $request): JsonResponse
    {
        return $this->responder(function () use ($request): JsonResponse {
            $q = $this->consulta($request, self::CATALOGO, []);

            if ($q instanceof JsonResponse) {
                return $q;
            }

            $categorias = isset($q['categoria']) ? array_map('trim', explode(',', $q['categoria'])) : [];

            if (array_diff($categorias, array_column(CategoriaServicio::cases(), 'value')) !== []) {
                return $this->invalido(['Categoría de servicio inválida.']);
            }

            $consulta = CatalogoServicio::query()->publicados()
                ->when($categorias, fn (Builder $b) => $b->whereIn('categoria', $categorias))
                ->when($q['search'] ?? null, fn (Builder $b, string $v) => $this->contiene($b, 'titulo', $v))
                ->orderBy('orden')->orderByDesc('id');

            return $this->pagina($consulta, $q, PresentadorContenido::servicio(...));
        });
    }

    public function servicio(int $id): JsonResponse
    {
        return $this->detalle(CatalogoServicio::query()->publicados(), $id, PresentadorContenido::servicio(...));
    }

    public function preguntas(Request $request): JsonResponse
    {
        return $this->responder(function () use ($request): JsonResponse {
            $q = $this->consulta($request, self::CATALOGO, []);

            if ($q instanceof JsonResponse) {
                return $q;
            }

            $consulta = PreguntaFrecuente::query()->publicados()
                ->when($q['categoria'] ?? null, fn (Builder $b, string $v) => $b->where('categoria', $v))
                ->when($q['search'] ?? null, fn (Builder $b, string $v) => $this->contiene($b, 'pregunta', $v))
                ->orderBy('orden')->orderByDesc('id');

            return $this->pagina($consulta, $q, PresentadorContenido::pregunta(...));
        });
    }

    public function pregunta(int $id): JsonResponse
    {
        return $this->detalle(PreguntaFrecuente::query()->publicados(), $id, PresentadorContenido::pregunta(...));
    }

    public function galeria(Request $request): JsonResponse
    {
        return $this->responder(function () use ($request): JsonResponse {
            $q = $this->consulta($request, ['categoria', 'page', 'limit'], ['categoria' => ['max:50']], limite: 24);

            if ($q instanceof JsonResponse) {
                return $q;
            }

            $consulta = GaleriaItem::query()->publicados()
                ->when($q['categoria'] ?? null, fn (Builder $b, string $v) => $b->where('categoria', $v))
                ->orderBy('orden')->orderByDesc('created_at')->orderByDesc('id');
            $respuesta = $this->pagina($consulta, $q, PresentadorContenido::foto(...))->getData(true);

            // Claves heredadas de NestJS: total y la lista de categorías con fotos visibles.
            return response()->json([
                'ok' => true,
                'total' => $respuesta['pagination']['total'],
                'items' => $respuesta['items'],
                'categorias' => GaleriaItem::query()->publicados()->distinct()->orderBy('categoria')->pluck('categoria')->all(),
                'pagination' => $respuesta['pagination'],
            ]);
        });
    }

    public function foto(int $id): JsonResponse
    {
        return $this->detalle(GaleriaItem::query()->publicados(), $id, PresentadorContenido::foto(...));
    }

    public function convenios(Request $request): JsonResponse
    {
        return $this->responder(function () use ($request): JsonResponse {
            $q = $this->consulta($request, ['page', 'limit', 'search', 'estado'], ['estado' => ['in:visible,oculto']]);

            if ($q instanceof JsonResponse) {
                return $q;
            }

            // Las listas no cargan fotos ni textos completos; «estado» solo filtra en la administración.
            $consulta = Convenio::query()->publicados()
                ->select(['id', 'nombre', 'sigla', 'logo_url', 'descripcion_corta', 'orden', 'visible'])
                ->when($q['search'] ?? null, fn (Builder $b, string $v) => $b->where(
                    fn (Builder $o) => $this->contiene($this->contiene($o, 'nombre', $v), 'sigla', $v, 'or'),
                ))
                ->orderBy('orden')->orderBy('id');

            return $this->pagina($consulta, $q, PresentadorContenido::convenio(...));
        });
    }

    public function convenio(int $id): JsonResponse
    {
        // El detalle incluye sus fotos en una sola petición (sin N+1).
        return $this->detalle(Convenio::query()->publicados()->with('fotos'), $id, PresentadorContenido::convenioDetalle(...), 'Convenio no encontrado.');
    }

    public function ajustes(): JsonResponse
    {
        return $this->responder(fn (): JsonResponse => response()->json(['ok' => true, 'settings' => AjustePublico::publicos()]));
    }

    /**
     * Valida la cadena de consulta: solo claves permitidas, enteros acotados y textos recortados.
     *
     * @param  list<string>  $permitidos
     * @param  array<string, list<string>>  $reglas
     * @return array<string, mixed>|JsonResponse
     */
    private function consulta(Request $request, array $permitidos, array $reglas, int $limite = 20): array|JsonResponse
    {
        $entrada = $request->query();
        $desconocidos = array_diff(array_keys($entrada), $permitidos);

        if ($desconocidos !== []) {
            return $this->invalido(array_values(array_map(fn (string $p): string => "El parámetro «{$p}» no está permitido.", $desconocidos)));
        }

        $entrada = array_map(fn (mixed $v): mixed => is_string($v) ? trim($v) : $v, $entrada);
        $base = [
            'page' => ['sometimes', 'integer', 'min:1', 'max:1000000'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'search' => ['sometimes', 'string', 'min:1', 'max:100'],
            'categoria' => ['sometimes', 'string', 'min:1', 'max:100'],
            'estado' => ['sometimes', Rule::in(['borrador', 'publicado', 'archivado', 'visible', 'oculto'])],
        ];

        foreach ($reglas as $campo => $extra) {
            $base[$campo] = [...($base[$campo] ?? ['sometimes', 'string']), ...$extra];
        }

        $validador = Validator::make($entrada, array_intersect_key($base, array_flip($permitidos)));

        if ($validador->fails()) {
            return $this->invalido($validador->errors()->all());
        }

        $datos = $validador->validated();
        $datos['page'] = (int) ($datos['page'] ?? 1);
        $datos['limit'] = (int) ($datos['limit'] ?? $limite);

        return $datos;
    }

    /**
     * @param  Builder<Model>  $consulta
     * @param  array<string, mixed>  $q
     */
    private function pagina(Builder $consulta, array $q, Closure $presentar): JsonResponse
    {
        $total = (clone $consulta)->reorder()->count();
        $items = $consulta->forPage($q['page'], $q['limit'])->get()->map($presentar)->values()->all();

        return response()->json([
            'ok' => true,
            'items' => $items,
            'pagination' => ['page' => $q['page'], 'limit' => $q['limit'], 'total' => $total, 'pages' => (int) ceil($total / $q['limit'])],
        ]);
    }

    /**
     * @param  Builder<Model>  $consulta
     */
    private function detalle(Builder $consulta, int $id, Closure $presentar, string $mensaje = self::NO_ENCONTRADO): JsonResponse
    {
        return $this->responder(function () use ($consulta, $id, $presentar, $mensaje): JsonResponse {
            $item = $consulta->whereKey($id)->first();

            return $item
                ? response()->json(['ok' => true, 'item' => $presentar($item)])
                : response()->json(['ok' => false, 'mensaje' => $mensaje], 404);
        });
    }

    /**
     * Búsqueda literal (los comodines % y _ del visitante no se interpretan). Se escapa
     * con «!»: la barra invertida no es portable entre SQLite y MySQL en ESCAPE.
     *
     * @param  Builder<Model>  $consulta
     * @return Builder<Model>
     */
    private function contiene(Builder $consulta, string $columna, string $texto, string $union = 'and'): Builder
    {
        $literal = str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $texto);

        return $consulta->whereRaw($consulta->getGrammar()->wrap($columna)." LIKE ? ESCAPE '!'", ['%'.$literal.'%'], $union);
    }

    /**
     * @param  list<string>  $mensajes
     */
    private function invalido(array $mensajes): JsonResponse
    {
        return response()->json(['ok' => false, 'mensaje' => $mensajes], 400);
    }

    /**
     * Una base sin las tablas de contenido (migración pendiente) responde 503 neutro,
     * sin detalles internos; el registro del servidor indica la causa.
     */
    private function responder(Closure $operacion): JsonResponse
    {
        try {
            return $operacion();
        } catch (QueryException $e) {
            Log::error('API de contenido: consulta fallida. Revise las migraciones de contenido público.', ['sqlstate' => $e->errorInfo[0] ?? null]);

            return response()->json(['ok' => false, 'mensaje' => 'El contenido no está disponible en este momento.'], 503);
        }
    }
}
