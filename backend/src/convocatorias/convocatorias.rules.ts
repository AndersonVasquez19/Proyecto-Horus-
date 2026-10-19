import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConvocatoriaEstado } from '@prisma/client';

export function validateEdition(item: { fecha_inicio: string | null; fecha_fin: string | null; capacidad: number | null }, occupied: number, opening: boolean) {
  if (item.fecha_inicio && item.fecha_fin && item.fecha_fin < item.fecha_inicio) throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
  if (opening && (!item.fecha_inicio || !item.fecha_fin || !item.capacidad)) throw new ConflictException('Define ambas fechas y la capacidad antes de abrir la edición.');
  if (item.capacidad !== null && item.capacidad < occupied) throw new ConflictException('La capacidad no puede ser menor al número de matrículas activas.');
}
export function validateTransition(from: ConvocatoriaEstado, to: ConvocatoriaEstado, archived: boolean) {
  const allowed: Record<ConvocatoriaEstado, readonly ConvocatoriaEstado[]> = { planificada: ['abierta', 'cancelada'], abierta: ['cerrada', 'cancelada'], cerrada: [], cancelada: [] };
  if (archived || !allowed[from].includes(to)) throw new ConflictException('El estado actual no permite esa operación. Consulta la edición vigente.');
}
