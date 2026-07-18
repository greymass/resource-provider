CREATE TABLE `provider_bucket` (
	`name` text PRIMARY KEY NOT NULL,
	`priority` integer NOT NULL,
	`limit_ms` integer NOT NULL,
	`limit_kb` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_rule` (
	`name` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_rule_pattern` (
	`rule` text NOT NULL,
	`kind` text NOT NULL,
	`pattern` text NOT NULL,
	PRIMARY KEY(`rule`, `kind`, `pattern`)
);
--> statement-breakpoint
ALTER TABLE `usage` ADD `bucket` text DEFAULT 'wildcard' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_usage_account_bucket_created` ON `usage` (`account`,`bucket`,`created_at`);