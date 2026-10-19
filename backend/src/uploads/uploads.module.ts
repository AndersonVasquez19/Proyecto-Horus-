import { BadRequestException, Controller, Get, Header, Module, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthModule } from '../admin/auth/auth.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UploadsService } from './uploads.service';
import { PublicRoute, RequirePermission } from '../permissions/access.decorators';
@ApiTags('Imágenes')
@Controller('uploads')
export class PublicUploadsController {
 constructor(private readonly service:UploadsService){}
 @Get(':filename') @PublicRoute() @Header('X-Content-Type-Options','nosniff') @Header('Cache-Control','public, max-age=31536000, immutable') read(@Param('filename') filename:string){return this.service.read(filename);}
}
@ApiTags('Admin - Imágenes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/uploads')
export class AdminUploadsController {
 constructor(private readonly service:UploadsService){}
 @Post() @RequirePermission('archivos:crear') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:0}}))
 save(@UploadedFile() file:{buffer:Buffer}|undefined){if(!file)throw new BadRequestException('Selecciona una imagen.');return this.service.save(file.buffer);}
}
@Module({imports:[AuthModule],controllers:[PublicUploadsController,AdminUploadsController],providers:[UploadsService]})
export class UploadsModule {}
