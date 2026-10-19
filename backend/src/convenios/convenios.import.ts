import type { Prisma, PrismaClient } from '@prisma/client';
import { isUniqueViolation } from '../database/serialization';
import { initialConvenios } from './initial-content';

type InitialConvenio = Pick<Prisma.ConvenioCreateInput, 'nombre' | 'sigla' | 'descripcion_corta' | 'descripcion_completa' | 'informacion_adicional' | 'orden' | 'visible'> & { origen_local: string; logoFile: string };

export async function importConvenios(
  client: Pick<PrismaClient, 'convenio'>,
  upload: (file: string) => Promise<string>,
  rows: readonly InitialConvenio[] = initialConvenios,
) {
  const logos = new Map<string, string>();
  let created = 0, skipped = 0;
  for (const row of rows) {
    if (await client.convenio.findUnique({ where: { origen_local: row.origen_local } })) { skipped++; continue; }
    const { logoFile, ...data } = row;
    let logo_url = logos.get(logoFile);
    if (!logo_url) { logo_url = await upload(logoFile); logos.set(logoFile, logo_url); }
    try {
      await client.convenio.create({ data: { ...data, logo_url } });
      created++;
    } catch (error) {
      // Una ejecución concurrente puede haber insertado la misma clave.
      if (!isUniqueViolation(error)) throw error;
      if (!await client.convenio.findUnique({ where: { origen_local: row.origen_local } })) throw error;
      skipped++;
    }
  }
  return { created, skipped };
}
