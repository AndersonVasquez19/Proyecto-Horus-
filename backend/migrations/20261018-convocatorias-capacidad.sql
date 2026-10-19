ALTER TABLE `convocatorias`
  ADD COLUMN `capacidad` INT NULL,
  ADD CONSTRAINT `convocatorias_capacidad_chk` CHECK (`capacidad` IS NULL OR `capacidad` >= 1);
