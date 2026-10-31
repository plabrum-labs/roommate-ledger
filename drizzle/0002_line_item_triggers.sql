-- Immutability: once an invoice has been issued onto the ledger its lines are frozen.
CREATE TRIGGER invoice_line_items_posted_no_insert
BEFORE INSERT ON invoice_line_items
WHEN EXISTS (SELECT 1 FROM ledger_entries WHERE invoice_id = NEW.invoice_id AND kind = 'invoiceIssued')
BEGIN
  SELECT RAISE(ABORT, 'invoice is posted; void and reissue');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_posted_no_update
BEFORE UPDATE ON invoice_line_items
WHEN EXISTS (SELECT 1 FROM ledger_entries
              WHERE invoice_id IN (OLD.invoice_id, NEW.invoice_id) AND kind = 'invoiceIssued')
BEGIN
  SELECT RAISE(ABORT, 'invoice is posted; void and reissue');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_posted_no_delete
BEFORE DELETE ON invoice_line_items
WHEN EXISTS (SELECT 1 FROM ledger_entries WHERE invoice_id = OLD.invoice_id AND kind = 'invoiceIssued')
BEGIN
  SELECT RAISE(ABORT, 'invoice is posted; void and reissue');
END;
--> statement-breakpoint
-- An invoice must keep at least one line (its amount_cents CHECK is > 0). Skipped once the invoice row
-- itself is gone, so a wipe can delete invoices (with deferred FKs) and then their lines.
CREATE TRIGGER invoice_line_items_keep_last_on_delete
BEFORE DELETE ON invoice_line_items
WHEN EXISTS (SELECT 1 FROM invoices WHERE id = OLD.invoice_id)
 AND (SELECT count(*) FROM invoice_line_items WHERE invoice_id = OLD.invoice_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'invoice must keep at least one line item');
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_keep_last_on_move
BEFORE UPDATE OF invoice_id ON invoice_line_items
WHEN NEW.invoice_id != OLD.invoice_id
 AND (SELECT count(*) FROM invoice_line_items WHERE invoice_id = OLD.invoice_id) = 1
BEGIN
  SELECT RAISE(ABORT, 'invoice must keep at least one line item');
END;
--> statement-breakpoint
-- Denormalisation: invoices.amount_cents is always the sum of the invoice's line items.
CREATE TRIGGER invoice_line_items_sum_insert
AFTER INSERT ON invoice_line_items
BEGIN
  UPDATE invoices
  SET amount_cents = (SELECT sum(amount_cents) FROM invoice_line_items WHERE invoice_id = NEW.invoice_id)
  WHERE id = NEW.invoice_id;
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_sum_update
AFTER UPDATE ON invoice_line_items
BEGIN
  UPDATE invoices
  SET amount_cents = (SELECT sum(amount_cents) FROM invoice_line_items WHERE invoice_id = invoices.id)
  WHERE id IN (OLD.invoice_id, NEW.invoice_id);
END;
--> statement-breakpoint
CREATE TRIGGER invoice_line_items_sum_delete
AFTER DELETE ON invoice_line_items
BEGIN
  UPDATE invoices
  SET amount_cents = (SELECT sum(amount_cents) FROM invoice_line_items WHERE invoice_id = OLD.invoice_id)
  WHERE id = OLD.invoice_id;
END;
