ALTER TABLE `estudiantes`
  DROP CHECK `estudiantes_documento_formato_chk`,
  ADD CONSTRAINT `estudiantes_documento_formato_chk` CHECK (`doc_tipo` IS NULL OR (`doc_pais` IS NOT NULL AND `doc_numero` IS NOT NULL AND `doc_tipo` = 'DNI' AND REGEXP_LIKE(`doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`doc_numero`, '^[0-9]{8}$', 'c') AND CHAR_LENGTH(`doc_numero`) = 8)),
  MODIFY `doc_tipo` ENUM('DNI') NULL;

ALTER TABLE `certificados`
  DROP CHECK `certificados_documento_chk`,
  ADD CONSTRAINT `certificados_documento_chk` CHECK (`estudiante_doc_tipo` = 'DNI' AND REGEXP_LIKE(`estudiante_doc_pais`, '^PE$', 'c') AND REGEXP_LIKE(`estudiante_doc_numero`, '^[0-9]{8}$', 'c') AND CHAR_LENGTH(`estudiante_doc_numero`) = 8),
  MODIFY `estudiante_doc_tipo` ENUM('DNI') NOT NULL;
