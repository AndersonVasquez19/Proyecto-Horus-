import { Transform } from 'class-transformer';
import { normalizeEmail, trimValue, MaxUtf8Bytes } from '../../../common/validation';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Administrador Principal' })
  @IsString()
  @IsNotEmpty()
  @Transform(trimValue)
  @Length(1, 100)
  nombre: string;

  @ApiProperty({ example: 'admin@horus.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  email: string;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @MaxUtf8Bytes(72)
  @Length(8, 72)
  password: string;
}
