import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRoute, PublicRoute, RequirePermission } from '../../permissions/access.decorators';
import { AccountsService } from './accounts.service';
import { AccountRoleDto, AccountStatusDto, ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/account.dto';
@ApiTags('Admin - Cuentas')
@Controller('admin')
export class AccountsController {
 constructor(private readonly accounts:AccountsService){}
 @Post('forgot-password') @PublicRoute() @HttpCode(200) forgot(@Body() dto:ForgotPasswordDto){return this.accounts.forgot(dto.email);}
 @Post('reset-password') @PublicRoute() @HttpCode(200) reset(@Body() dto:ResetPasswordDto){return this.accounts.reset(dto);}
 @Post('password') @AuthenticatedRoute() @HttpCode(200) @ApiBearerAuth() @UseGuards(JwtAuthGuard) password(@CurrentUser('id') id:number,@Body() dto:ChangePasswordDto){return this.accounts.password(id,dto);}
 @Get('users') @RequirePermission('cuentas:leer') @ApiBearerAuth() @UseGuards(JwtAuthGuard) list(){return this.accounts.list();}
 @Put('users/:id/rol') @RequirePermission('cuentas:asignar_rol') @ApiBearerAuth() @UseGuards(JwtAuthGuard) role(@Param('id',ParseIntPipe) id:number,@Body() dto:AccountRoleDto,@CurrentUser('id') actor:number){return this.accounts.role(id,dto.rol,dto.rol_actual,actor);}
 @Put('users/:id') @RequirePermission('cuentas:editar') @ApiBearerAuth() @UseGuards(JwtAuthGuard) status(@Param('id',ParseIntPipe) id:number,@Body() dto:AccountStatusDto,@CurrentUser('id') actor:number){return this.accounts.status(id,dto.activo,actor);}
}
