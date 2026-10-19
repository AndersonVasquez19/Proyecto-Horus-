<?php

/*
 * Mensajes de validación en español para las reglas usadas en el panel.
 * Las reglas no traducidas aquí recurren al idioma de respaldo (inglés).
 */

return [
    'accepted' => 'Debe aceptar :attribute.',
    'after_or_equal' => ':Attribute debe ser una fecha posterior o igual a :date.',
    'array' => ':Attribute debe ser una lista.',
    'before_or_equal' => ':Attribute debe ser una fecha anterior o igual a :date.',
    'boolean' => ':Attribute debe ser verdadero o falso.',
    'date' => ':Attribute no es una fecha válida.',
    'date_format' => ':Attribute no tiene el formato :format.',
    'digits' => ':Attribute debe tener :digits dígitos.',
    'digits_between' => ':Attribute debe tener entre :min y :max dígitos.',
    'email' => ':Attribute debe ser un correo electrónico válido.',
    'enum' => 'El valor seleccionado en :attribute no es válido.',
    'exists' => 'El valor seleccionado en :attribute no existe.',
    'filled' => ':Attribute es obligatorio.',
    'in' => 'El valor seleccionado en :attribute no es válido.',
    'integer' => ':Attribute debe ser un número entero.',
    'max' => [
        'array' => ':Attribute no debe tener más de :max elementos.',
        'file' => ':Attribute no debe pesar más de :max kilobytes.',
        'numeric' => ':Attribute no debe ser mayor que :max.',
        'string' => ':Attribute no debe tener más de :max caracteres.',
    ],
    'min' => [
        'array' => ':Attribute debe tener al menos :min elementos.',
        'file' => ':Attribute debe pesar al menos :min kilobytes.',
        'numeric' => ':Attribute debe ser al menos :min.',
        'string' => ':Attribute debe tener al menos :min caracteres.',
    ],
    'numeric' => ':Attribute debe ser un número.',
    'regex' => 'El formato de :attribute no es válido.',
    'required' => ':Attribute es obligatorio.',
    'required_if' => ':Attribute es obligatorio cuando :other es :value.',
    'required_unless' => ':Attribute es obligatorio salvo que :other sea :values.',
    'size' => [
        'array' => ':Attribute debe contener :size elementos.',
        'file' => ':Attribute debe pesar :size kilobytes.',
        'numeric' => ':Attribute debe ser :size.',
        'string' => ':Attribute debe tener :size caracteres.',
    ],
    'string' => ':Attribute debe ser texto.',
    'unique' => 'Ya existe un registro con ese valor en :attribute.',

    'custom' => [],

    'attributes' => [],
];
