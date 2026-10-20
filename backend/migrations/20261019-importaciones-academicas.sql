CREATE TABLE IF NOT EXISTS `importaciones_academicas` (
  id CHAR(36) NOT NULL,
  archivo_sha256 CHAR(64) NOT NULL,
  convocatoria_id INT NOT NULL,
  actor_id INT NOT NULL,
  estado ENUM('confirmada') NOT NULL DEFAULT 'confirmada',
  importados INT NOT NULL,
  omitidos INT NOT NULL,
  rechazados INT NOT NULL,
  estudiantes_nuevos INT NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY importaciones_archivo_destino_uq (archivo_sha256, convocatoria_id),
  CONSTRAINT importaciones_convocatoria_fk FOREIGN KEY (convocatoria_id) REFERENCES convocatorias(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT importaciones_actor_fk FOREIGN KEY (actor_id) REFERENCES admin_users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `importaciones_conteos_ck` CHECK (importados > 0 AND omitidos >= 0 AND rechazados >= 0 AND estudiantes_nuevos >= 0 AND estudiantes_nuevos <= importados)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
