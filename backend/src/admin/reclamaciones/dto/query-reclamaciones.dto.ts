import { IsIn, IsOptional } from 'class-validator';
import { ListQueryDto } from '../../../common/list-query.dto';
export class QueryReclamacionesDto extends ListQueryDto {
 @IsOptional() @IsIn(['reclamo','queja']) tipo_registro?:'reclamo'|'queja';
}
