# The app's database. Schema migrations are applied by wrangler in CI (`wrangler d1 migrations apply --remote`);
# Terraform only owns the database's existence. Destroying it would delete every invoice, payment and ledger
# entry, so it is protected.
resource "cloudflare_d1_database" "main" {
  account_id = var.cloudflare_account_id
  name       = "roommate-ledger"

  lifecycle {
    prevent_destroy = true
  }
}
