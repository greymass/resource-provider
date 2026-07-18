CREATE TABLE `config` (
	`scope` text DEFAULT 'global' NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
