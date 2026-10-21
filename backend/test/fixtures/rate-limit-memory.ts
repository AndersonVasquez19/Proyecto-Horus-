// Memoria que imita lo mínimo de rate_limit_buckets que usa PublicRateLimitGuard: el alta idempotente del cubo y el incremento condicional
// (count < tope). Cada transacción lleva su propio registro de incrementos y los deshace si falla, como haría MySQL. Aislado: sin base de datos.
// La atomicidad REAL entre procesos y las solicitudes simultáneas se prueban en MySQL desechable (preinscripciones.integration.cjs).
export function memoryBuckets() {
  const buckets = new Map<string, number>();
  const prisma: any = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      const undo: string[] = [];
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          if (sql.startsWith('INSERT INTO rate_limit_buckets')) { const id = String(values[0]); if (!buckets.has(id)) buckets.set(id, 0); return 1; }
          if (sql.startsWith('UPDATE rate_limit_buckets SET count = count + 1')) {
            const id = String(values[0]), max = Number(values[1]);
            if ((buckets.get(id) ?? 0) >= max) return 0;
            buckets.set(id, (buckets.get(id) ?? 0) + 1); undo.push(id); return 1;
          }
          throw new Error('SQL inesperado en el almacén de pruebas');
        },
      };
      try { return await run(tx); }
      catch (error) { for (const id of undo) buckets.set(id, (buckets.get(id) ?? 1) - 1); throw error; }
    },
    rateLimitBucket: { deleteMany: async () => ({ count: 0 }) },
  };
  return { buckets, prisma, total: () => [...buckets.values()].reduce((sum, value) => sum + value, 0) };
}
