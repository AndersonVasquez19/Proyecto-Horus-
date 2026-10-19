// Coste de bcrypt de TODAS las contraseñas administrativas (alta, cambio y restablecimiento).
export const BCRYPT_COST = 12;

// Hash bcrypt (coste = BCRYPT_COST) de una contraseña aleatoria que se descartó al generarlo: nadie conoce su texto.
// El login lo compara cuando la cuenta no existe o está inactiva para que esas rutas también ejecuten bcrypt, en vez de
// responder de inmediato. Es una constante: no se calcula nada por petición ni al arrancar. Una prueba comprueba que su
// coste coincide con BCRYPT_COST; si cambia el coste de las contraseñas reales hay que regenerarlo.
// Reduce la diferencia evidente de procesamiento; no promete tiempos idénticos (consulta a la base de datos, red, etc.).
export const DUMMY_PASSWORD_HASH = '$2a$12$ZMITRepa5dkSFREfjCLclej4AipRqfyumh1b3Bp8TLjRbblzhGdTK';
