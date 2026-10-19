# syntax=docker/dockerfile:1
FROM php:8.4-fpm-bookworm AS php-base

RUN apt-get update \
    && apt-get install -y --no-install-recommends libicu72 libzip4 libicu-dev libzip-dev libfcgi-bin unzip \
    && docker-php-ext-install -j2 intl pdo_mysql zip bcmath pcntl \
    && apt-get purge -y --auto-remove libicu-dev libzip-dev \
    && rm -rf /var/lib/apt/lists/*

COPY docker/php.ini /usr/local/etc/php/conf.d/zz-horus.ini
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/zz-horus.conf
WORKDIR /var/www/html

FROM php-base AS build
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY composer.json composer.lock ./
# Ningún script Composer puede migrar, crear SQLite o leer un entorno del anfitrión.
RUN composer install --no-dev --prefer-dist --no-interaction --no-progress --no-scripts --no-autoloader
COPY app ./app
COPY bootstrap/app.php bootstrap/providers.php ./bootstrap/
COPY config ./config
COPY database/factories ./database/factories
COPY database/migrations ./database/migrations
COPY database/seeders ./database/seeders
COPY lang ./lang
COPY public ./public
COPY resources ./resources
COPY routes ./routes
COPY artisan ./artisan
RUN mkdir -p bootstrap/cache storage/app/private storage/app/public \
        storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs \
    && composer dump-autoload --no-dev --optimize --no-interaction --no-scripts \
    && APP_ENV=production CACHE_STORE=array SESSION_DRIVER=array php artisan package:discover --ansi \
    && APP_ENV=production CACHE_STORE=array SESSION_DRIVER=array php artisan filament:assets \
    && ln -s /var/www/html/storage/app/public public/storage \
    && chown -R www-data:www-data storage bootstrap/cache

FROM php-base AS app
COPY --from=build /var/www/html /var/www/html
USER www-data
EXPOSE 9000
# Arranque deliberadamente sin migraciones, seeders, generación de claves ni caches de rutas.
CMD ["php-fpm", "-F"]

FROM nginx:stable-alpine AS web
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /var/www/html/public /var/www/html/public
USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
