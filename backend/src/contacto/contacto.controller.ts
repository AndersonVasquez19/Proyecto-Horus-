import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ContactoService } from './contacto.service';
import { CreateContactoDto } from './dto/create-contacto.dto';
import { PublicRoute } from '../permissions/access.decorators';

@ApiTags('Contacto')
@Controller('contacto')
export class ContactoController {
  constructor(private readonly contactoService: ContactoService) {}

  @Post()
  @PublicRoute()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enviar mensaje de contacto desde la web' })
  @ApiResponse({ status: 201, description: 'Mensaje recibido exitosamente' })
  async create(@Body() dto: CreateContactoDto) {
    return this.contactoService.create(dto);
  }
}
