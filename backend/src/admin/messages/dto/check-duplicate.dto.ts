import { PickType } from '@nestjs/swagger';
import { CreateAdminMessageDto } from './create-message.dto';

// Comprobación de posibles duplicados (POST /api/admin/messages/duplicados). Reutiliza EXACTAMENTE las reglas de CreateAdminMessageDto (recorte,
// formato de correo y longitudes) para los tres campos que se comparan; nombre y teléfono no participan. El ValidationPipe global
// (whitelist + forbidNonWhitelisted) rechaza con 400 cualquier otro campo, de modo que no se puede pedir una búsqueda parcial ni más datos.
export class CheckDuplicateMessageDto extends PickType(CreateAdminMessageDto, ['email', 'asunto', 'mensaje'] as const) {}
