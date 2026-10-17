<?php

// Antes del autoload y del arranque de Laravel: nunca heredar destinos reales.
$environment = [
    'APP_ENV' => 'testing',
    'HORUS_PUBLIC_AUTH_ENABLED' => 'true',
    'APP_DEBUG' => 'false',
    'APP_KEY' => 'base64:'.base64_encode(random_bytes(32)),
    'APP_CONFIG_CACHE' => __DIR__.'/../storage/framework/testing/config-'.bin2hex(random_bytes(16)).'.php',
    'DB_CONNECTION' => 'sqlite',
    'DB_DATABASE' => ':memory:',
    'DB_URL' => '',
    'CACHE_STORE' => 'array',
    'SESSION_DRIVER' => 'array',
    'MAIL_MAILER' => 'array',
    'QUEUE_CONNECTION' => 'sync',
    'BROADCAST_CONNECTION' => 'null',
    'LOG_CHANNEL' => '"null"',
    'APP_MAINTENANCE_DRIVER' => 'file',
    'BCRYPT_ROUNDS' => '4',
    'RESEND_API_KEY' => '',
    'POSTMARK_API_KEY' => '',
    'AWS_ACCESS_KEY_ID' => '',
    'AWS_SECRET_ACCESS_KEY' => '',
    'SLACK_BOT_USER_OAUTH_TOKEN' => '',
];

foreach ($environment as $name => $value) {
    putenv($name.'='.$value);
    $_ENV[$name] = $value;
    $_SERVER[$name] = $value;
}

// El archivo deliberadamente ausente impide cargar .env o .env.testing locales.
if (is_file(__DIR__.'/.env.phpunit')) {
    throw new RuntimeException('Retire tests/.env.phpunit: las pruebas no aceptan archivos de entorno locales.');
}

require __DIR__.'/../vendor/autoload.php';
