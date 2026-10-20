import { useMemo } from 'react';
import { readInstitutionalResource } from './source';
import { InstitutionalContentError } from './read';
import type { PublicErrorKind } from '../publicErrors';

const reload = () => { /* El contenido versionado se actualiza con el siguiente build. */ };

// Adaptador para Carlos: misma forma que usePublicResource, exclusivamente para contenido institucional.
// No sustituir globalmente el cliente público: formularios y menú del chatbot siguen usando NestJS.
export function useInstitutionalResource<T>(path: string) {
  return useMemo(() => {
    try {
      return { data: readInstitutionalResource(path) as T, loading: false, error: '', errorKind: null as PublicErrorKind | null, reload };
    } catch (error) {
      const notFound = error instanceof InstitutionalContentError && error.status === 404;
      return { data: null as T | null, loading: false, error: notFound ? 'El contenido que buscas no está disponible.' : 'No se pudo consultar el contenido institucional.', errorKind: (notFound ? 'notFound' : 'badRequest') as PublicErrorKind, reload };
    }
  }, [path]);
}
