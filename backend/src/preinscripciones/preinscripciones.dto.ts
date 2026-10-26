import { Transform, Type } from 'class-transformer';
import { Equals, IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { normalizeEmail, PHONE_PATTERN, trimValue } from '../common/validation';
import { CursosConvocatoriaQueryDto } from '../convocatorias/convocatorias.dto';
import { NoPersonalData } from './preinscripciones.privacy';

// ---- Público -------------------------------------------------------------------------------------------------------------------
// Solo estos campos. El resto (canal, estado, origen, edición por id, revisión…) lo fija el servidor: el ValidationPipe global rechaza
// con 400 cualquier campo ajeno (forbidNonWhitelisted), de modo que el cliente no puede elegir un origen administrativo.
// Validación según AGENTS.md: obligatorio, longitud máxima del esquema y formato; sin longitudes mínimas inventadas. Sin DNI, pagos
// ni comprobantes.
export class RegistroPreinscripcionDto {
  // Código opaco de la edición (GET /preinscripciones/convocatorias). Nunca el id secuencial.
  @Transform(trimValue) @IsString() @Matches(/^[0-9a-f]{32}$/, { message: 'La edición indicada no es válida.' })
  convocatoria: string;

  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120)
  nombres: string;

  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120)
  apellidos: string;

  @Transform(normalizeEmail) @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254)
  email: string;

  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'El teléfono es obligatorio.' }) @MaxLength(30)
  @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' })
  telefono: string;

  // JSON crudo: la conversión implícita convertiría la cadena "false" en true. Solo el booleano true es consentimiento.
  @Transform(({ obj }) => obj.consentimiento)
  @Equals(true, { message: 'Debes aceptar el tratamiento de tus datos para preinscribirte.' })
  consentimiento: boolean;

  // Campo trampa para robots: oculto al visitante. Si llega con contenido se responde como éxito sin guardar nada.
  @IsOptional() @IsString() @MaxLength(200)
  website?: string;
}

// El chatbot exige además que el visitante haya CONFIRMADO el resumen de sus datos antes de enviarlos.
export class ChatbotPreinscripcionDto extends RegistroPreinscripcionDto {
  @Transform(({ obj }) => obj.confirmacion)
  @Equals(true, { message: 'Debes confirmar tus datos antes de enviar la preinscripción.' })
  confirmacion: boolean;
}

// ---- Administración ------------------------------------------------------------------------------------------------------------
// Identificador entero de la query (se convierte explícitamente: la conversión implícita está desactivada).
const ID = (): PropertyDecorator => (target, key) => { Type(() => Number)(target, key); IsInt()(target, key); Min(1)(target, key); Max(2147483647)(target, key); };

export class PreinscripcionesQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @ID() convocatoria_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @ID() curso_id?: number;
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['recibida', 'validada', 'matriculada', 'desistida', 'descartada']) estado?: 'recibida' | 'validada' | 'matriculada' | 'desistida' | 'descartada';
  @ValidateIf((_o, v) => v !== undefined) @IsIn(['formulario', 'chatbot']) canal?: 'formulario' | 'chatbot';
}

export class ResumenPreinscripcionesQueryDto extends CursosConvocatoriaQueryDto {
  @ValidateIf((_o, v) => v !== undefined) @ID() convocatoria_id?: number;
  @IsIn(['activos', 'archivados', 'todos']) archivo: 'activos' | 'archivados' | 'todos' = 'activos';
}

export class RevisionPreinscripcionDto {
  @IsInt() @Min(1) @Max(2147483646) revision: number;
}

// El motivo se conserva en el historial: sin correos, teléfonos, documentos ni contraseñas (ver preinscripciones.privacy.ts).
export class DescartePreinscripcionDto extends RevisionPreinscripcionDto {
  @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Indica el motivo.' }) @MaxLength(300) @NoPersonalData() motivo: string;
}

export class DesistimientoPreinscripcionDto extends RevisionPreinscripcionDto {
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty() @MaxLength(300) @NoPersonalData() motivo?: string;
}

export class UpdatePreinscripcionDto extends RevisionPreinscripcionDto {
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los nombres son obligatorios.' }) @MaxLength(120) nombres?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'Los apellidos son obligatorios.' }) @MaxLength(120) apellidos?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(normalizeEmail) @IsEmail({}, { message: 'Introduce un correo válido.' }) @MaxLength(254) email?: string;
  @ValidateIf((_o, v) => v !== undefined) @Transform(trimValue) @IsString() @IsNotEmpty({ message: 'El teléfono es obligatorio.' }) @MaxLength(30) @Matches(PHONE_PATTERN, { message: 'Introduce un teléfono válido.' }) telefono?: string;
}

// El DNI (doc_numero) es SIEMPRE obligatorio: lo teclea la persona que revisó el documento y es el ancla de identidad. Sirve para buscar al
// estudiante registrado o para crear uno nuevo. `estudiante_id` es opcional y solo CONFIRMA la selección: debe ser el estudiante cuyo DNI se
// tecleó; si no lo es, la conversión se bloquea (no se puede vincular un estudiante arbitrario). El servicio compara además nombres y contacto.
export class ConvertirPreinscripcionDto extends RevisionPreinscripcionDto {
  @ValidateIf((_o, v) => v !== undefined) @IsInt() @Min(1) @Max(2147483647) estudiante_id?: number;
  // Sin trim: no convertir un documento inválido en uno válido (misma regla que Estudiantes).
  @IsString({ message: 'El DNI es obligatorio para verificar la identidad.' }) @Matches(/^[0-9]{8}$/, { message: 'El DNI debe tener exactamente 8 dígitos.' }) @MaxLength(8) doc_numero: string;
}
