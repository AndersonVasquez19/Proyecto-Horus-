<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\InicioSesionPublico;
use App\Http\Requests\Auth\RegistroPublico;
use App\Models\User;
use App\Support\CorreoUsuario;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

class SesionPublicaController extends Controller
{
    public function register(RegistroPublico $request): JsonResponse
    {
        if (Auth::guard('web')->check()) {
            return response()->json(['message' => 'Ya existe una sesión iniciada.'], 409);
        }

        try {
            $usuario = new User($request->safe()->only(['name', 'email', 'password']));
            $usuario->rol = null;
            $usuario->activo = true;
            $usuario->save();
        } catch (UniqueConstraintViolationException) {
            // Dos registros concurrentes normalizados compiten por users.email UNIQUE.
            throw ValidationException::withMessages(['email' => 'Este correo ya está registrado.']);
        }

        Auth::guard('web')->login($usuario);
        $request->session()->regenerate();

        return $this->cuenta($usuario, 201);
    }

    public function login(InicioSesionPublico $request): JsonResponse
    {
        if (Auth::guard('web')->check()) {
            return response()->json(['message' => 'Ya existe una sesión iniciada.'], 409);
        }

        $email = $request->validated('email');
        $correcto = Auth::guard('web')->attempt([
            fn (Builder $query) => CorreoUsuario::filtrar($query, $email),
            'password' => $request->validated('password'),
            'activo' => true,
        ], remember: false);

        if (! $correcto) {
            return response()->json(['message' => 'Credenciales inválidas.'], 401);
        }

        $request->session()->regenerate();

        return $this->cuenta(Auth::guard('web')->user());
    }

    public function me(): JsonResponse
    {
        return $this->cuenta(Auth::guard('web')->user());
    }

    public function logout(Request $request): Response
    {
        Auth::guard('web')->logout();
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    private function cuenta(User $usuario, int $estado = 200): JsonResponse
    {
        // Lista explícita: nunca serializar el modelo ni relaciones académicas.
        return response()->json(['user' => [
            'id' => $usuario->id,
            'name' => $usuario->name,
            'email' => $usuario->email,
        ]], $estado);
    }
}
