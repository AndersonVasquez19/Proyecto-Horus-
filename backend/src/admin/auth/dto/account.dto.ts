import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsString, Length } from 'class-validator';
import { ADMIN_ROLES, AdminRole } from '../../../permissions/roles';
import { normalizeEmail, MaxUtf8Bytes } from '../../../common/validation';
export class ForgotPasswordDto { @Transform(normalizeEmail) @IsEmail() @Length(3,254) email:string; }
export class ResetPasswordDto {
 @IsString() @Length(1,3000) token:string;
 @IsString() @IsNotEmpty() @Length(8,72) @MaxUtf8Bytes(72) password:string;
}
export class ChangePasswordDto {
 @IsString() @IsNotEmpty() @Length(1,72) @MaxUtf8Bytes(72) current_password:string;
 @IsString() @IsNotEmpty() @Length(8,72) @MaxUtf8Bytes(72) password:string;
}
export class AccountStatusDto { @IsBoolean() activo:boolean; }
// Cambio de rol desde el panel: `rol` es el nuevo (null = retirar) y `rol_actual` el que mostraba la lista (control de cambios concurrentes).
// Ambos son obligatorios: un valor ausente o fuera de los tres roles (o de null) se rechaza con 400.
export class AccountRoleDto {
 @IsIn([...ADMIN_ROLES,null]) rol:AdminRole|null;
 @IsIn([...ADMIN_ROLES,null]) rol_actual:AdminRole|null;
}
