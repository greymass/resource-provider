CREATE TABLE `tokens` (
	`name` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`level` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_hash_unique` ON `tokens` (`hash`);