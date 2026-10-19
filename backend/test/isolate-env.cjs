// Precarga de las pruebas (node --test -r ./test/isolate-env.cjs ...).
// Importar @prisma/client carga automáticamente backend/.env en process.env, de modo que cualquier prueba que toque
// un módulo con Prisma recibía credenciales reales (claves de correo, base de datos, JWT). Se fuerza esa carga aquí
// y se eliminan las variables que aporta el archivo: las pruebas parten solo del entorno del proceso y definen
// su propia configuración ficticia. No se lee ni se muestra ningún valor.
const inherited = new Set(Object.keys(process.env));
try { require('@prisma/client'); } catch { /* Sin cliente generado no hay nada que aislar. */ }
for (const key of Object.keys(process.env)) if (!inherited.has(key)) delete process.env[key];
