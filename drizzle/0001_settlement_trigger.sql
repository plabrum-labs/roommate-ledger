CREATE TRIGGER ledger_recompute_settlement
AFTER INSERT ON ledger_entries
WHEN NEW.party_leg
BEGIN
  UPDATE invoices
  SET applied_cents = max(0, min(
        amount_cents,
        (SELECT abs(coalesce(sum(e.amount_cents), 0))
           FROM ledger_entries e
          WHERE e.account_id = NEW.account_id AND e.kind = 'payment')
        - coalesce((SELECT sum(o.amount_cents)
                      FROM invoices o
                     WHERE o.id IN (SELECT invoice_id FROM ledger_entries
                                     WHERE account_id = NEW.account_id
                                       AND kind = 'invoiceIssued' AND reverses_group_id IS NULL)
                       AND o.status != 'void'
                       AND (o.issued_at, o.id) < (invoices.issued_at, invoices.id)), 0)
      ))
  WHERE status != 'void'
    AND id IN (SELECT invoice_id FROM ledger_entries
                WHERE account_id = NEW.account_id
                  AND kind = 'invoiceIssued' AND reverses_group_id IS NULL);

  UPDATE invoices
  SET settlement = CASE WHEN applied_cents = amount_cents THEN 'paid'
                        WHEN applied_cents > 0 THEN 'partially_paid'
                        ELSE 'unpaid' END
  WHERE status != 'void'
    AND id IN (SELECT invoice_id FROM ledger_entries
                WHERE account_id = NEW.account_id
                  AND kind = 'invoiceIssued' AND reverses_group_id IS NULL);
END;
