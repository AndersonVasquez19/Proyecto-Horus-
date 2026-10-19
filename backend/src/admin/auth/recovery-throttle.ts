import { createHash } from 'node:crypto';

// Límite por cuenta de los correos de recuperación, complementario al límite por IP del endpoint. Se cuenta cada solicitud (exista o no la cuenta)
// para que la respuesta sea idéntica; al superar el límite solo se omite el envío, sin cambiar la respuesta HTTP.
// Memoria acotada y por instancia: se reinicia con el proceso y no se comparte entre instancias de NestJS.
export class RecoveryThrottle {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit = 3, private readonly windowMs = 15 * 60_000, private readonly maxKeys = 5000, private readonly now: () => number = Date.now) {}
  private key(email: string) { return createHash('sha256').update(email.trim().toLowerCase()).digest('hex'); } // no se guarda el correo en claro
  // true = se puede enviar; false = se superó el límite de esta cuenta en la ventana.
  allow(email: string): boolean {
    const now = this.now(), key = this.key(email);
    const recent = (this.hits.get(key) ?? []).filter(time => now - time < this.windowMs);
    const allowed = recent.length < this.limit;
    // Solo las solicitudes permitidas cuentan: una solicitud bloqueada no prolonga la ventana, así que repetirlas no mantiene la cuenta bloqueada.
    if (allowed) recent.push(now);
    this.hits.delete(key); // reinserta al final para conservar el orden de uso
    if (recent.length) this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return allowed;
  }
  private prune(now: number) {
    for (const [key, times] of this.hits) if (!times.some(time => now - time < this.windowMs)) this.hits.delete(key);
    while (this.hits.size > this.maxKeys) { const oldest = this.hits.keys().next().value; if (oldest === undefined) break; this.hits.delete(oldest); }
  }
  get size() { return this.hits.size; }
}
