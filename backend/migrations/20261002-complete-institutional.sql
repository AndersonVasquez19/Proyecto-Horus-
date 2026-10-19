ALTER TABLE admin_users ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE, ADD COLUMN session_version INT NOT NULL DEFAULT 1;
ALTER TABLE newsletter_subscribers ADD COLUMN consent_at DATETIME NULL;
CREATE TABLE IF NOT EXISTS attention_records (
 id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 contacto_id INT NULL,
 reclamacion_id INT NULL,
 recurso VARCHAR(20) NOT NULL,
 registro_id INT NOT NULL,
 estado VARCHAR(20) NOT NULL DEFAULT 'nuevo',
 responsable VARCHAR(100) NOT NULL DEFAULT '',
 notas TEXT NOT NULL,
 respuesta TEXT NOT NULL,
 revision INT NOT NULL DEFAULT 1,
 historial JSON NOT NULL,
 updatedAt DATETIME NOT NULL,
 UNIQUE KEY attention_record_resource (recurso,registro_id),
 CONSTRAINT attention_contact_fk FOREIGN KEY (contacto_id) REFERENCES contactos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT attention_complaint_fk FOREIGN KEY (reclamacion_id) REFERENCES reclamaciones(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 count INT NOT NULL,
 expiresAt DATETIME NOT NULL,
 KEY rate_limit_expires_idx (expiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
UPDATE cotizaciones c LEFT JOIN contactos m ON m.id=c.contacto_id SET c.contacto_id=NULL WHERE c.contacto_id IS NOT NULL AND m.id IS NULL;
ALTER TABLE cotizaciones ADD KEY cotizaciones_contacto_id_idx (contacto_id), ADD CONSTRAINT cotizaciones_contacto_fk FOREIGN KEY (contacto_id) REFERENCES contactos(id) ON DELETE RESTRICT ON UPDATE CASCADE;
