# Proxy HTTP de Azure Container Apps

Configuración preparada en D.4; no se ha desplegado ni verificado la topología de Azure.
No requiere VNet, Front Door ni Application Gateway.

## Modos excluyentes

- Sin variables: Express ignora `X-Forwarded-For` y usa la dirección del socket. Conserva el entorno local.
- `TRUSTED_PROXY_CIDRS`: conserva las IPs/CIDRs explícitos de confianza; rechaza comodines y `/0`.
- `TRUSTED_PROXY_HOPS=1`: acepta exclusivamente la cadena literal `1`. Omitir la variable para desactivarla;
  un valor vacío también se rechaza. `TRUSTED_PROXY_CIDRS` debe estar ausente o sin direcciones.
  Configurar ambos modos produce un error de arranque. Nunca se utiliza `trust proxy=true`.

## Condición de seguridad

Topología prevista: navegador → ingress HTTP de Azure → NestJS. Vercel sirve la SPA;
el navegador llama directamente al dominio HTTPS de la API. El ingress debe ser la única vía hacia NestJS,
sin puertos TCP adicionales, exposición directa del contenedor ni rutas internas que permitan saltarse el ingress.
No activar este modo hasta comprobar esa condición, también para otros clientes dentro del entorno.

[Azure documenta](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)
que añade la IP a la derecha de `X-Forwarded-For`: los valores anteriores pueden proceder del cliente.
Con un salto Express toma esa dirección derecha, ignorando los prefijos falsificados.
[Express advierte](https://expressjs.com/en/guide/behind-proxies.html) que la confianza por saltos exige
que no haya caminos más cortos hasta la aplicación. Este modo **no autentica al proxy**:
un cliente que llegue directamente a NestJS puede falsificar su IP y eludir la cuota por IP.
Un proxy adicional antes de Azure cambia la IP observada y puede compartir la cuota entre visitantes.

El limitador conserva su lógica y sus contadores persistentes. Las pruebas locales usan el guard real,
NestJS y contadores simulados sin MySQL. Cubren IPv4, IPv6, IPv4 mapeada, prefijos manipulados,
cuotas independientes, desconfianza por defecto y la evasión mediante acceso directo.
No prueban la normalización de variantes equivalentes de IP ni acreditan el ingress real.

## Validación pendiente en un despliegue de pruebas autorizado

1. Construir y validar una nueva candidata de imagen con este código: la imagen r4 anterior no contiene D.4.
2. Confirmar único ingress HTTP/HTTPS, destino 3000, `HOST=0.0.0.0`, sin acceso directo al proceso.
3. Configurar `TRUSTED_PROXY_HOPS=1` y omitir CIDRs; mantener secretos fuera de Git.
4. Comprobar IP y cuotas con dos clientes, IPv4/IPv6 y cabeceras manipuladas por la entrada pública.
   Usar una sonda temporal protegida o registros controlados sin añadir una ruta pública de diagnóstico.
5. Comprobar que las rutas alternativas no alcanzan directamente NestJS, además de CORS y preflight
   desde el origen Vercel exacto. Si cambia la cadena de proxies, revisar el modo antes de habilitar tráfico.

La publicación y el despliegue requieren una autorización separada. El procedimiento de imagen
se conserva en [imagen-backend-azure-ghcr.md](imagen-backend-azure-ghcr.md).
