import { Body, Controller, Get, Module, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AuthModule } from '../admin/auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequirePermission } from '../permissions/access.decorators';
import { OriginalContentService } from './content-original.service';

export class RestoreOriginalDto {
  @IsIn(['borrador','publicado']) estado:'borrador'|'publicado'='publicado';
}
@ApiTags('Admin - Contenido original')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/contenido-original')
export class OriginalContentController {
  constructor(private readonly service:OriginalContentService){}
  @Get() @RequirePermission('contenido_original:leer') inventory(){return this.service.inventory();}
  @Post(':section') @RequirePermission('contenido_original:restaurar') restore(@Param('section') section:string,@Body() dto:RestoreOriginalDto){return this.service.restore(section,dto.estado);}
}
@Module({imports:[AuthModule],controllers:[OriginalContentController],providers:[OriginalContentService],exports:[OriginalContentService]})
export class OriginalContentModule {}
