CREATE TABLE `invoice_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `batch_id` text REFERENCES invoice_batches(id);--> statement-breakpoint
CREATE INDEX `invoices_batch_idx` ON `invoices` (`batch_id`);