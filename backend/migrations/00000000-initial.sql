CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(100) NOT NULL,
  `email` VARCHAR(254) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `admin_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(150) NOT NULL,
  `descripcion` TEXT NOT NULL,
  `categoria` VARCHAR(50) NOT NULL DEFAULT 'general',
  `estado` VARCHAR(20) NOT NULL DEFAULT 'activo',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `cursos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(180) NOT NULL UNIQUE,
  `descripcion` TEXT NOT NULL,
  `tipo` ENUM('curso', 'capacitacion') NOT NULL,
  `modalidad` ENUM('presencial', 'virtual', 'hibrida') NOT NULL,
  `duracion` VARCHAR(120) NOT NULL,
  `temario` TEXT NULL,
  `imagen_url` VARCHAR(2048) NULL,
  `fecha_inicio` DATETIME NULL,
  `estado` ENUM('borrador', 'publicado', 'archivado') NOT NULL DEFAULT 'borrador',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `servicios` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(160) NOT NULL,
  `slug` VARCHAR(180) NOT NULL UNIQUE,
  `descripcion` TEXT NOT NULL,
  `categoria` ENUM('cableado', 'camaras', 'soporte', 'asesoramiento', 'otros') NOT NULL,
  `alcance` TEXT NULL,
  `imagen_url` VARCHAR(2048) NULL,
  `estado` ENUM('borrador', 'publicado', 'archivado') NOT NULL DEFAULT 'borrador',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `preguntas_frecuentes` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `pregunta` VARCHAR(300) NOT NULL,
  `respuesta` TEXT NOT NULL,
  `categoria` VARCHAR(100) NOT NULL,
  `orden` INTEGER NOT NULL DEFAULT 0,
  `estado` ENUM('borrador', 'publicado', 'archivado') NOT NULL DEFAULT 'borrador',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `contactos` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(255) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `telefono` VARCHAR(255) NOT NULL,
  `asunto` VARCHAR(255) NOT NULL,
  `mensaje` TEXT NOT NULL,
  `estado` VARCHAR(255) NOT NULL DEFAULT 'nuevo',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `cotizaciones` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `numero` VARCHAR(60) NOT NULL UNIQUE,
  `cliente` VARCHAR(160) NOT NULL,
  `email` VARCHAR(254) NOT NULL,
  `telefono` VARCHAR(30) NOT NULL,
  `documento` VARCHAR(30) NOT NULL,
  `direccion` VARCHAR(300) NOT NULL,
  `emisor` VARCHAR(160) NOT NULL,
  `datos_emisor` VARCHAR(500) NOT NULL,
  `moneda` VARCHAR(3) NOT NULL,
  `validez` DATE NOT NULL,
  `condiciones` TEXT NOT NULL,
  `conceptos` JSON NOT NULL,
  `subtotal` DECIMAL(14,2) NOT NULL,
  `descuento` DECIMAL(14,2) NOT NULL,
  `tasa` DECIMAL(5,2) NOT NULL,
  `impuesto` DECIMAL(14,2) NOT NULL,
  `total` DECIMAL(14,2) NOT NULL,
  `estado` VARCHAR(20) NOT NULL DEFAULT 'borrador',
  `contacto_id` INTEGER NULL,
  `revision` INTEGER NOT NULL DEFAULT 1,
  `historial` JSON NOT NULL,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `galeria_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `titulo` VARCHAR(150) NOT NULL,
  `descripcion` TEXT NULL,
  `categoria` VARCHAR(50) NOT NULL DEFAULT 'general',
  `imagen_url` VARCHAR(500) NOT NULL,
  `orden` INTEGER NULL DEFAULT 0,
  `activo` TINYINT(1) NULL DEFAULT true,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `newsletter_subscribers` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(254) NOT NULL UNIQUE,
  `interes` VARCHAR(100) NOT NULL DEFAULT 'novedades',
  `activo` TINYINT(1) NULL DEFAULT true,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `reclamaciones` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `numero_reclamo` VARCHAR(255) NULL UNIQUE,
  `nombres` VARCHAR(255) NOT NULL,
  `apellidos` VARCHAR(255) NOT NULL,
  `tipo_doc` VARCHAR(255) NULL,
  `num_doc` VARCHAR(255) NULL,
  `email` VARCHAR(255) NOT NULL,
  `telefono` VARCHAR(255) NOT NULL,
  `direccion` VARCHAR(255) NULL,
  `tipo_registro` ENUM('reclamo', 'queja') NOT NULL,
  `area` VARCHAR(255) NOT NULL,
  `fecha_incidente` DATE NOT NULL,
  `descripcion_bien` TEXT NOT NULL,
  `detalle_reclamo` TEXT NOT NULL,
  `acepta_comunicaciones` TINYINT(1) NULL DEFAULT false,
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `empresa_settings` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `clave` VARCHAR(50) NOT NULL UNIQUE,
  `valor` TEXT NOT NULL,
  `descripcion` VARCHAR(200) NULL,
  `grupo` VARCHAR(50) NOT NULL DEFAULT 'general',
  `createdAt` DATETIME NOT NULL,
  `updatedAt` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;
