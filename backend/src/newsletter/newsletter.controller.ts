import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NewsletterService } from './newsletter.service';
import { UnsubscribeNewsletterDto, SubscribeNewsletterDto } from './dto/subscribe-newsletter.dto';
import { PublicRoute } from '../permissions/access.decorators';

@ApiTags('Boletín')
@Controller('newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('unsubscribe')
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  unsubscribe(@Body() dto: UnsubscribeNewsletterDto) { return this.newsletterService.unsubscribe(dto.token); }

  @Post()
  @PublicRoute()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suscribirse al boletín informativo o novedades de Horus' })
  @ApiResponse({ status: 200, description: 'Suscripción registrada con éxito' })
  async subscribe(@Body() dto: SubscribeNewsletterDto) {
    return this.newsletterService.subscribe(dto);
  }
}
