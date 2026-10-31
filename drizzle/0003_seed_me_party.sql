-- The one "me" party (the owner): the ledger's accounts and every invoice/payment foreign key hang off it, and
-- POST /parties refuses kind 'me', so a freshly migrated database must already contain it.
INSERT OR IGNORE INTO `parties` (`id`, `name`, `kind`, `venmo_handle`) VALUES ('me', 'Me', 'me', NULL);
