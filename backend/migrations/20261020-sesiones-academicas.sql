CREATE TABLE IF NOT EXISTS `sesiones` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `convocatoria_id` INT NOT NULL,
  `asignacion_id` INT NULL,
  `titulo` VARCHAR(160) NOT NULL,
  `fecha` DATE NOT NULL,
  `hora_inicio` TIME NOT NULL,
  `hora_fin` TIME NOT NULL,
  `modalidad` ENUM('presencial','virtual','hibrida') NOT NULL,
  `lugar` VARCHAR(200) NULL,
  `enlace_url` VARCHAR(2048) NULL,
  `estado` ENUM('programada','realizada','cancelada') NOT NULL DEFAULT 'programada',
  `cancelada_at` DATETIME(3) NULL,
  `cancelacion_motivo` VARCHAR(300) NULL,
  `observaciones` VARCHAR(500) NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `sesiones_id_edicion_uq` (`id`, `convocatoria_id`),
  KEY `sesiones_edicion_idx` (`convocatoria_id`, `fecha`, `hora_inicio`),
  KEY `sesiones_asignacion_idx` (`asignacion_id`, `convocatoria_id`, `fecha`),
  KEY `sesiones_fecha_idx` (`fecha`, `hora_inicio`),
  CONSTRAINT `sesiones_convocatoria_fk` FOREIGN KEY (`convocatoria_id`) REFERENCES `convocatorias` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `sesiones_asignacion_fk` FOREIGN KEY (`asignacion_id`, `convocatoria_id`) REFERENCES `docente_asignaciones` (`id`, `convocatoria_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `sesiones_titulo_chk` CHECK (CHAR_LENGTH(TRIM(`titulo`)) > 0),
  CONSTRAINT `sesiones_texto_chk` CHECK ((`lugar` IS NULL OR CHAR_LENGTH(TRIM(`lugar`)) > 0) AND (`enlace_url` IS NULL OR CHAR_LENGTH(TRIM(`enlace_url`)) > 0) AND (`observaciones` IS NULL OR CHAR_LENGTH(TRIM(`observaciones`)) > 0)),
  CONSTRAINT `sesiones_fecha_chk` CHECK (`fecha` >= '2000-01-01' AND `fecha` <= '2100-12-31'),
  CONSTRAINT `sesiones_horas_chk` CHECK (`hora_inicio` >= '00:00:00' AND `hora_inicio` < `hora_fin` AND `hora_fin` <= '23:59:00' AND SECOND(`hora_inicio`) = 0 AND SECOND(`hora_fin`) = 0),
  CONSTRAINT `sesiones_modalidad_chk` CHECK ((`modalidad` = 'presencial' AND `enlace_url` IS NULL) OR (`modalidad` = 'virtual' AND `lugar` IS NULL) OR `modalidad` = 'hibrida'),
  CONSTRAINT `sesiones_enlace_chk` CHECK (`enlace_url` IS NULL OR REGEXP_LIKE(`enlace_url`, '^https://[^[:space:]]+$', 'c')),
  CONSTRAINT `sesiones_cancelacion_chk` CHECK ((`estado` = 'cancelada' AND `cancelada_at` IS NOT NULL AND `cancelacion_motivo` IS NOT NULL AND CHAR_LENGTH(TRIM(`cancelacion_motivo`)) > 0) OR (`estado` IN ('programada','realizada') AND `cancelada_at` IS NULL AND `cancelacion_motivo` IS NULL)),
  CONSTRAINT `sesiones_revision_chk` CHECK (`revision` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `academico_historial` MODIFY `entidad` ENUM('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente','sesion') NOT NULL;

ALTER TABLE `academico_historial` MODIFY `operacion` ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion','reprogramacion') NOT NULL;
