import { Body, Controller, Get, Module, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../admin/auth/auth.module';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RequireFollowUp } from '../permissions/access.decorators';
import { AttentionDto, AttentionResendDto, AttentionSendDto } from './attention.dto';
import { AttentionService } from './attention.service';
@ApiTags('Admin - Seguimiento')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/seguimiento/:recurso/:id')
export class AttentionController {
 constructor(private readonly service:AttentionService){}
 @Get() @RequireFollowUp('leer') get(@Param('recurso') recurso:string,@Param('id',ParseIntPipe) id:number){return this.service.get(recurso,id,true);}
 @Put() @RequireFollowUp('editar') save(@Param('recurso') recurso:string,@Param('id',ParseIntPipe) id:number,@Body() dto:AttentionDto,@CurrentUser('id') user:number){return this.service.save(recurso,id,dto,user);}
 @Post('constancia') @RequireFollowUp('enviar') receipt(@Param('recurso') recurso:string,@Param('id',ParseIntPipe) id:number,@Body() dto:AttentionResendDto,@CurrentUser('id') user:number){return this.service.receipt(recurso,id,user,dto?.confirmar_reenvio===true);}
 @Post('correo') @RequireFollowUp('enviar') send(@Param('recurso') recurso:string,@Param('id',ParseIntPipe) id:number,@Body() dto:AttentionSendDto,@CurrentUser('id') user:number){return this.service.send(recurso,id,dto.revision,user,dto.confirmar_reenvio===true);}
}
@Module({imports:[AuthModule],controllers:[AttentionController],providers:[AttentionService]})
export class AttentionModule {}
