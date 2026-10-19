import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { trimValue } from '../../common/validation';
export class GaleriaQueryDto {
  @ValidateIf((_, value) => value !== undefined) @Transform(trimValue) @IsString() @Length(1, 50)
  categoria?: string;
  @ValidateIf((_, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(1000000)
  page?: number;
  @ValidateIf((_, value) => value !== undefined) @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
