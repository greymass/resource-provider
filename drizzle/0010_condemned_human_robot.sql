CREATE TABLE `provider_bucket_account` (
	`bucket` text NOT NULL,
	`account` text NOT NULL,
	PRIMARY KEY(`bucket`, `account`)
);
--> statement-breakpoint
CREATE INDEX `idx_bucket_account_account` ON `provider_bucket_account` (`account`);