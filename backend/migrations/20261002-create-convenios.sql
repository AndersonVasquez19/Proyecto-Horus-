CREATE TABLE IF NOT EXISTS `convenios` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `nombre` VARCHAR(160) NOT NULL,
  `sigla` VARCHAR(50) NULL,
  `logo_url` VARCHAR(2048) NULL,
  `descripcion_corta` TEXT NOT NULL,
  `descripcion_completa` TEXT NULL,
  `informacion_adicional` TEXT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `visible` BOOLEAN NOT NULL DEFAULT FALSE,
  `origen_local` VARCHAR(150) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `convenios_origen_local` (`origen_local`),
  KEY `convenios_visible_orden_idx` (`visible`, `orden`),
  KEY `convenios_orden_idx` (`orden`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `convenio_fotos` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `convenio_id` INT NOT NULL,
  `imagen_url` VARCHAR(2048) NOT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `convenio_fotos_convenio_orden_idx` (`convenio_id`, `orden`),
  CONSTRAINT `convenio_fotos_convenio_id_fkey` FOREIGN KEY (`convenio_id`) REFERENCES `convenios` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
