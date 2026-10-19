import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { rsaPublicKey } from './connection-security';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaMariaDb({
        host: config.get<string>('DB_HOST', 'localhost'),
        port: Number(config.get('DB_PORT', 3306)),
        user: config.get<string>('DB_USER', 'root'),
        password: config.get<string>('DB_PASS', ''),
        database: config.get<string>('DB_NAME', 'horus_db'),
        connectionLimit: 2, connectTimeout: 10000, acquireTimeout: 15000, idleTimeout: 10,
        timezone: '+00:00',
        cachingRsaPublicKey: rsaPublicKey(config.get('DB_RSA_PUBLIC_KEY')),
        ...(config.get<string>('DB_SSL') === 'true' ? {
          ssl: {
            rejectUnauthorized: true,
            ...(config.get<string>('DB_SSL_CA') ? { ca: config.get<string>('DB_SSL_CA').replace(/\\n/g, '\n') } : {}),
          },
        } : {}),
      }),
    });
  }
  async onModuleInit() { await this.$connect(); await this.$queryRaw`SELECT 1`; }
  async onModuleDestroy() { await this.$disconnect(); }
}
