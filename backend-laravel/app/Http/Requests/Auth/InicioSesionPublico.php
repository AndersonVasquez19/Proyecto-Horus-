<?php

namespace App\Http\Requests\Auth;

class InicioSesionPublico extends EntradaPublica
{
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ];
    }
}
