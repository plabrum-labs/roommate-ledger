CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoice_line_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_line_items_amount_positive" CHECK("invoice_line_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `invoice_line_items_invoice_idx` ON `invoice_line_items` (`invoice_id`,`position`);--> statement-breakpoint
CREATE TABLE `invoice_transitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`at` text NOT NULL,
	`note` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `invoice_transitions_invoice_idx` ON `invoice_transitions` (`invoice_id`,`id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`payer_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`issued_at` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`settlement` text DEFAULT 'unpaid' NOT NULL,
	`applied_cents` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`payer_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payee_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoices_amount_positive" CHECK("invoices"."amount_cents" > 0),
	CONSTRAINT "invoices_applied_range" CHECK("invoices"."applied_cents" >= 0 AND "invoices"."applied_cents" <= "invoices"."amount_cents"),
	CONSTRAINT "invoices_parties_differ" CHECK("invoices"."payer_id" != "invoices"."payee_id")
);
--> statement-breakpoint
CREATE INDEX `invoices_payer_idx` ON `invoices` (`payer_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `invoices_payee_idx` ON `invoices` (`payee_id`,`issued_at`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_group_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`occurred_at` text NOT NULL,
	`kind` text NOT NULL,
	`reverses_group_id` text,
	`party_leg` integer NOT NULL,
	`invoice_id` text,
	`payment_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entries_one_source" CHECK(("ledger_entries"."invoice_id" IS NULL) != ("ledger_entries"."payment_id" IS NULL)),
	CONSTRAINT "ledger_entries_nonzero" CHECK("ledger_entries"."amount_cents" != 0)
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_account_time_idx` ON `ledger_entries` (`account_id`,`occurred_at`,`amount_cents`);--> statement-breakpoint
CREATE INDEX `ledger_entries_account_kind_invoice_idx` ON `ledger_entries` (`account_id`,`kind`,`invoice_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_group_idx` ON `ledger_entries` (`entry_group_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_reverses_idx` ON `ledger_entries` (`reverses_group_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_invoice_idx` ON `ledger_entries` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `ledger_entries_payment_idx` ON `ledger_entries` (`payment_id`);--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`venmo_handle` text
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`payer_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`paid_at` text NOT NULL,
	`method` text NOT NULL,
	`reference` text,
	FOREIGN KEY (`payer_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payee_id`) REFERENCES `parties`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_amount_positive" CHECK("payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE INDEX `payments_payer_idx` ON `payments` (`payer_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `payments_payee_idx` ON `payments` (`payee_id`,`paid_at`);