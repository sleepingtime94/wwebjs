CREATE TABLE IF NOT EXISTS `message_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `message_id` varchar(255) DEFAULT NULL,
  `sender` varchar(50) NOT NULL DEFAULT 'API',
  `number` varchar(50) NOT NULL,
  `message` text NOT NULL,
  `status` enum('pending','sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
  `ack` int DEFAULT 0,
  `error_message` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_msg_id` (`message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
