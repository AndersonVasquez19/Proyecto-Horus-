CREATE TABLE IF NOT EXISTS `convocatoria_horarios` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `convocatoria_id` INT NOT NULL,
  `dia_semana` TINYINT NOT NULL,
  `hora_inicio` TIME NOT NULL,
  `hora_fin` TIME NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `convocatoria_horarios_inicio_uq` (`convocatoria_id`, `dia_semana`, `hora_inicio`),
  CONSTRAINT `convocatoria_horarios_convocatoria_fk` FOREIGN KEY (`convocatoria_id`) REFERENCES `convocatorias` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `convocatoria_horarios_dia_chk` CHECK (`dia_semana` >= 1 AND `dia_semana` <= 7),
  CONSTRAINT `convocatoria_horarios_horas_chk` CHECK (`hora_inicio` >= '00:00:00' AND `hora_inicio` < `hora_fin` AND `hora_fin` <= '23:59:00' AND SECOND(`hora_inicio`) = 0 AND SECOND(`hora_fin`) = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
