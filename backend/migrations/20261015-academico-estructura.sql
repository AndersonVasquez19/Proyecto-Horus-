CREATE TABLE IF NOT EXISTS `estudiantes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `nombres` VARCHAR(120) NOT NULL,
  `apellidos` VARCHAR(120) NOT NULL,
  `doc_pais` CHAR(2) NULL,
  `doc_tipo` ENUM('DNI','CE','PASAPORTE') NULL,
  `doc_numero` VARCHAR(20) NULL,
  `email` VARCHAR(254) NULL,
  `telefono` VARCHAR(30) NULL,
  `archivado_at` DATETIME(3) NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `estudiantes_documento_uq` (`doc_pais`, `doc_tipo`, `doc_numero`),
  KEY `estudiantes_nombre_idx` (`apellidos`, `nombres`),
  CONSTRAINT `estudiantes_nombres_chk` CHECK (CHAR_LENGTH(TRIM(`nombres`)) > 0),
  CONSTRAINT `estudiantes_documento_completo_chk` CHECK ((`doc_pais` IS NULL AND `doc_tipo` IS NULL AND `doc_numero` IS NULL) OR (`doc_pais` IS NOT NULL AND `doc_tipo` IS NOT NULL AND `doc_numero` IS NOT NULL)),
  CONSTRAINT `estudiantes_documento_formato_chk` CHECK (`doc_tipo` IS NULL OR (`doc_pais` IS NOT NULL AND `doc_numero` IS NOT NULL AND (
    (`doc_tipo` = 'DNI' AND REGEXP_LIKE(`doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`doc_numero`, '^[0-9]{8}$', 'c'))
    OR (`doc_tipo` = 'CE' AND REGEXP_LIKE(`doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`doc_numero`, '^[A-Z0-9]{1,12}$', 'c'))
    OR (`doc_tipo` = 'PASAPORTE' AND REGEXP_LIKE(`doc_pais`, '^[A-Z]{2}$', 'c') AND REGEXP_LIKE(`doc_numero`, '^[A-Z0-9]{1,20}$', 'c'))))),
  CONSTRAINT `estudiantes_revision_chk` CHECK (`revision` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `convocatorias` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `curso_id` INT NOT NULL,
  `nombre` VARCHAR(160) NOT NULL,
  `fecha_inicio` DATE NULL,
  `fecha_fin` DATE NULL,
  `estado` ENUM('planificada','abierta','cerrada','cancelada') NOT NULL DEFAULT 'planificada',
  `archivado_at` DATETIME(3) NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `convocatorias_curso_idx` (`curso_id`, `fecha_inicio`),
  KEY `convocatorias_estado_idx` (`estado`, `fecha_inicio`),
  CONSTRAINT `convocatorias_curso_fk` FOREIGN KEY (`curso_id`) REFERENCES `cursos` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `convocatorias_nombre_chk` CHECK (CHAR_LENGTH(TRIM(`nombre`)) > 0),
  CONSTRAINT `convocatorias_fechas_chk` CHECK (`fecha_inicio` IS NULL OR `fecha_fin` IS NULL OR `fecha_fin` >= `fecha_inicio`),
  CONSTRAINT `convocatorias_revision_chk` CHECK (`revision` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `matriculas` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `estudiante_id` INT NOT NULL,
  `convocatoria_id` INT NOT NULL,
  `estado` ENUM('activa','anulada') NOT NULL DEFAULT 'activa',
  `cumplimiento` ENUM('pendiente','cumplido','no_cumplido') NOT NULL DEFAULT 'pendiente',
  `confirmado_por` INT NULL,
  `confirmado_rol` ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL') NULL,
  `confirmado_at` DATETIME(3) NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `matriculas_estudiante_convocatoria_uq` (`estudiante_id`, `convocatoria_id`),
  KEY `matriculas_convocatoria_idx` (`convocatoria_id`, `estado`),
  KEY `matriculas_confirmado_por_idx` (`confirmado_por`),
  CONSTRAINT `matriculas_estudiante_fk` FOREIGN KEY (`estudiante_id`) REFERENCES `estudiantes` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `matriculas_convocatoria_fk` FOREIGN KEY (`convocatoria_id`) REFERENCES `convocatorias` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `matriculas_confirmado_por_fk` FOREIGN KEY (`confirmado_por`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `matriculas_confirmacion_chk` CHECK ((`cumplimiento` = 'pendiente' AND `confirmado_por` IS NULL AND `confirmado_rol` IS NULL AND `confirmado_at` IS NULL)
    OR (`cumplimiento` IN ('cumplido','no_cumplido') AND `confirmado_por` IS NOT NULL AND `confirmado_at` IS NOT NULL
      AND `confirmado_rol` IS NOT NULL AND `confirmado_rol` IN ('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL'))),
  CONSTRAINT `matriculas_revision_chk` CHECK (`revision` >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `certificados` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `matricula_id` INT NOT NULL,
  `codigo_verificacion` VARCHAR(32) NOT NULL,
  `estado` ENUM('vigente','anulado') NOT NULL DEFAULT 'vigente',
  `vigente_matricula_id` INT GENERATED ALWAYS AS (CASE WHEN `estado` = 'vigente' THEN `matricula_id` ELSE NULL END) STORED,
  `estudiante_nombres` VARCHAR(120) NOT NULL,
  `estudiante_apellidos` VARCHAR(120) NOT NULL,
  `estudiante_doc_pais` CHAR(2) NOT NULL,
  `estudiante_doc_tipo` ENUM('DNI','CE','PASAPORTE') NOT NULL,
  `estudiante_doc_numero` VARCHAR(20) NOT NULL,
  `curso_titulo` VARCHAR(160) NOT NULL,
  `curso_tipo` ENUM('curso','capacitacion') NOT NULL,
  `curso_duracion` VARCHAR(120) NULL,
  `convocatoria_nombre` VARCHAR(160) NOT NULL,
  `convocatoria_fecha_inicio` DATE NULL,
  `convocatoria_fecha_fin` DATE NULL,
  `emitido_por` INT NOT NULL,
  `emitido_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `anulado_por` INT NULL,
  `anulado_at` DATETIME(3) NULL,
  `anulacion_motivo` VARCHAR(300) NULL,
  `sustituye_a_id` INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `certificados_codigo_uq` (`codigo_verificacion`),
  UNIQUE KEY `certificados_vigente_uq` (`vigente_matricula_id`),
  UNIQUE KEY `certificados_id_matricula_uq` (`id`, `matricula_id`),
  UNIQUE KEY `certificados_sustituye_uq` (`sustituye_a_id`, `matricula_id`),
  KEY `certificados_matricula_idx` (`matricula_id`, `emitido_at`),
  KEY `certificados_emitido_por_idx` (`emitido_por`),
  KEY `certificados_anulado_por_idx` (`anulado_por`),
  CONSTRAINT `certificados_matricula_fk` FOREIGN KEY (`matricula_id`) REFERENCES `matriculas` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `certificados_emitido_por_fk` FOREIGN KEY (`emitido_por`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `certificados_anulado_por_fk` FOREIGN KEY (`anulado_por`) REFERENCES `admin_users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `certificados_sustituye_fk` FOREIGN KEY (`sustituye_a_id`, `matricula_id`) REFERENCES `certificados` (`id`, `matricula_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `certificados_codigo_chk` CHECK (REGEXP_LIKE(`codigo_verificacion`, '^[A-Z0-9]{16,32}$', 'c')),
  CONSTRAINT `certificados_anulacion_chk` CHECK ((`estado` = 'vigente' AND `anulado_por` IS NULL AND `anulado_at` IS NULL AND `anulacion_motivo` IS NULL)
    OR (`estado` = 'anulado' AND `anulado_por` IS NOT NULL AND `anulado_at` IS NOT NULL AND `anulacion_motivo` IS NOT NULL AND CHAR_LENGTH(TRIM(`anulacion_motivo`)) > 0)),
  CONSTRAINT `certificados_nombres_chk` CHECK (CHAR_LENGTH(TRIM(`estudiante_nombres`)) > 0),
  CONSTRAINT `certificados_documento_chk` CHECK (
    (`estudiante_doc_tipo` = 'DNI' AND REGEXP_LIKE(`estudiante_doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`estudiante_doc_numero`, '^[0-9]{8}$', 'c'))
    OR (`estudiante_doc_tipo` = 'CE' AND REGEXP_LIKE(`estudiante_doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`estudiante_doc_numero`, '^[A-Z0-9]{1,12}$', 'c'))
    OR (`estudiante_doc_tipo` = 'PASAPORTE' AND REGEXP_LIKE(`estudiante_doc_pais`, '^[A-Z]{2}$', 'c') AND REGEXP_LIKE(`estudiante_doc_numero`, '^[A-Z0-9]{1,20}$', 'c'))),
  CONSTRAINT `certificados_fechas_chk` CHECK (`convocatoria_fecha_inicio` IS NULL OR `convocatoria_fecha_fin` IS NULL OR `convocatoria_fecha_fin` >= `convocatoria_fecha_inicio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `academico_historial` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `entidad` ENUM('estudiante','convocatoria','matricula','certificado') NOT NULL,
  `entidad_id` INT NOT NULL,
  `operacion` ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion') NOT NULL,
  `origen` ENUM('panel','terminal') NOT NULL,
  `actor_id` INT NULL,
  `actor_rol` ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA') NULL,
  `operador` VARCHAR(100) NULL,
  `estado_anterior` VARCHAR(30) NULL,
  `estado_nuevo` VARCHAR(30) NULL,
  `campos` JSON NULL,
  `revision` INT NULL,
  `motivo` VARCHAR(300) NULL,
  PRIMARY KEY (`id`),
  KEY `academico_historial_entidad_idx` (`entidad`, `entidad_id`, `createdAt`),
  KEY `academico_historial_actor_idx` (`actor_id`, `createdAt`),
  CONSTRAINT `academico_historial_origen_chk` CHECK ((`origen` = 'panel' AND `actor_id` IS NOT NULL)
    OR (`origen` = 'terminal' AND `operador` IS NOT NULL AND CHAR_LENGTH(TRIM(`operador`)) > 0)),
  CONSTRAINT `academico_historial_campos_chk` CHECK (`campos` IS NULL OR JSON_TYPE(`campos`) = 'ARRAY')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
