CREATE TABLE `audit_links` (
	`id` text PRIMARY KEY NOT NULL,
	`audit_id` text NOT NULL,
	`source_page_id` text NOT NULL,
	`target_page_id` text NOT NULL,
	FOREIGN KEY (`audit_id`) REFERENCES `audits`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `audit_links_audit_idx` ON `audit_links` (`audit_id`);