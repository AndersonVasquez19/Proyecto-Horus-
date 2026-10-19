<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Validator;

abstract class EntradaPublica extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if (is_string($this->input('email'))) {
            $this->merge(['email' => Str::lower(trim($this->input('email')))]);
        }
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            // Rechazar incluso rol=null y permissions=[]; no ignorarlos en silencio.
            foreach (array_diff(array_keys($this->all()), array_keys($this->rules()), ['_token']) as $campo) {
                $validator->errors()->add($campo, 'Este campo no está permitido.');
            }
        });
    }
}
