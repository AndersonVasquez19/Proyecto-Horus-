import { ValidationPipe } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

export const trimValue = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
// Formato de teléfono aceptado (sin longitud mínima inventada): dígitos y los separadores habituales.
export const PHONE_PATTERN = /^(?=.*\d)[+()\d\s.-]+$/;
export const normalizeEmail = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value;

export function createValidationPipe() {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
    transformOptions: { enableImplicitConversion: false } });
}

export function MaxUtf8Bytes(max: number, options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => registerDecorator({
    name: 'maxUtf8Bytes', target: target.constructor, propertyName: String(propertyKey), options,
    validator: { validate: value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      defaultMessage: () => 'La contraseña no debe superar ' + max + ' bytes UTF-8.' },
  });
}
