CREATE TABLE IF NOT EXISTS `admin_auditoria` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `origen` ENUM('panel','terminal') NOT NULL,
  `actor_id` INT NULL,
  `operador` VARCHAR(100) NULL,
  `cuenta_id` INT NOT NULL,
  `operacion` ENUM('cuenta_creada','cuenta_activada','cuenta_desactivada','rol_asignado','rol_retirado') NOT NULL,
  `rol_anterior` ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA') NULL,
  `rol_nuevo` ENUM('GERENTE_GENERAL','COORDINADORA_INSTITUCIONAL','SECRETARIA') NULL,
  `activo_anterior` BOOLEAN NULL,
  `activo_nuevo` BOOLEAN NULL,
  `resultado` ENUM('aplicado','rechazado') NOT NULL,
  `motivo` VARCHAR(200) NULL,
  KEY `admin_auditoria_cuenta_idx` (`cuenta_id`, `createdAt`),
  KEY `admin_auditoria_actor_idx` (`actor_id`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
