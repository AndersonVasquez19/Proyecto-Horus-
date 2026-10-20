import { institutionalCatalog } from './catalog';
import { createInstitutionalReader } from './read';
import corlad from '../assets/images/logos/logo-convenio-administracion.jpg';
import cec from '../assets/images/logos/logo-convenio-economistas.jpg';
import cep from '../assets/images/logos/logo-convenio-enfermeros.png';
import isam from '../assets/images/logos/logo-convenio-isam.png';

// Los mismos logos versionados del inventario original, resueltos por Vite con hash al compilar; sin copiar uploads.
const logos: Record<string, string> = { CORLAD: corlad, CEC: cec, 'CEP/CR XIII': cep, 'CEP/CR II': cep, ISAM: isam };
export const readInstitutionalResource = createInstitutionalReader({ ...institutionalCatalog,
  convenios: institutionalCatalog.convenios.map(row => ({ ...row, logo_url: logos[row.sigla ?? ''] ?? row.logo_url })),
});
