<?php

namespace App\Http\Requests\Auth;

use App\Models\User;
use App\Support\CorreoUsuario;
use Closure;

class RegistroPublico extends EntradaPublica
{
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['bail', 'required', 'string', 'email', 'max:255', function (string $attribute, mixed $value, Closure $fail): void {
                // Incluye administradores previos cuyo correo no estaba normalizado.
                if (CorreoUsuario::filtrar(User::query(), $value)->exists()) {
                    $fail('Este correo ya está registrado.');
                }
            }],
            'password' => ['bail', 'required', 'string', 'min:8', 'max:72', 'confirmed', function (string $attribute, mixed $value, Closure $fail): void {
                if (strlen($value) > 72) {
                    $fail('La contraseña no puede superar 72 bytes UTF-8.');
                }
                if (str_contains($value, "\0")) {
                    $fail('La contraseña contiene un carácter no permitido.');
                }
            }],
            'password_confirmation' => ['required', 'string'],
        ];
    }
}
