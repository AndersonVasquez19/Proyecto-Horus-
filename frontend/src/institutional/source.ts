import { institutionalCatalog } from './catalog';import { createInstitutionalReader } from './read';

// Los logos y fotos de convenios ya son archivos versionados en /contenido (ver catalog.ts); no se sustituyen aquí.
export const readInstitutionalResource = createInstitutionalReader(institutionalCatalog);
