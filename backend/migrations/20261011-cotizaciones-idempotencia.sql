ALTER TABLE cotizaciones ADD COLUMN idempotencia_clave VARCHAR(128) NULL;
ALTER TABLE cotizaciones ADD COLUMN idempotencia_huella CHAR(64) NULL;
ALTER TABLE cotizaciones ADD UNIQUE KEY cotizaciones_idempotencia_clave (idempotencia_clave);
