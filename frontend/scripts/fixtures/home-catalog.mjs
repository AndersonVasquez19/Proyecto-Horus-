// Catálogo de PRUEBA para scripts/smoke-home.cjs. Solo se usa en la compilación de revisión que hace ese smoke, donde sustituye a
// src/institutional/catalog.ts: nunca llega a frontend/dist ni al sitio real. El smoke lo sirve (y lo muta) en /__smoke/catalog.json;
// para aplicar un cambio recarga la página, igual que ocurre con el catálogo real al compilar.
const response = await fetch('/__smoke/catalog.json', { cache: 'no-store' })
if (!response.ok) throw new Error('El smoke no sirvió el catálogo de prueba.')
export const institutionalCatalog = await response.json()
