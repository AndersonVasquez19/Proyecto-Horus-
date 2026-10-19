ALTER TABLE contactos ADD COLUMN origen VARCHAR(20) NOT NULL DEFAULT 'web';
UPDATE contactos SET origen = 'chatbot' WHERE asunto LIKE '[Chatbot]%';
CREATE TABLE IF NOT EXISTS chatbot_interacciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  modo VARCHAR(10) NOT NULL,
  resuelta TINYINT(1) NOT NULL,
  fuentes INT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY chatbot_interacciones_created_idx (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS chatbot_preguntas_sin_respuesta (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  huella CHAR(64) NOT NULL,
  pregunta VARCHAR(500) NOT NULL,
  veces INT NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY chatbot_sin_respuesta_huella (huella),
  KEY chatbot_sin_respuesta_updated_idx (updatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
