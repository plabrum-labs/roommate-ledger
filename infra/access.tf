# Cloudflare Access in front of the whole app: one-time PIN login, 30-day sessions. The one-time-PIN identity
# provider is account-level and already exists (owned by the soren-em-wedding project's Terraform), so it is
# referenced by id (var.otp_idp_id) rather than created.

resource "cloudflare_zero_trust_access_policy" "owner" {
  account_id       = var.cloudflare_account_id
  name             = "roommate-ledger owner"
  decision         = "allow"
  session_duration = "720h"
  include          = [for e in var.allowed_emails : { email = { email = e } }]
}

resource "cloudflare_zero_trust_access_application" "app" {
  account_id                = var.cloudflare_account_id
  name                      = "roommate-ledger"
  type                      = "self_hosted"
  session_duration          = "720h"
  app_launcher_visible      = false
  allowed_idps              = [var.otp_idp_id]
  auto_redirect_to_identity = true
  destinations = [
    { type = "public", uri = var.hostname },
  ]
  policies = [
    { id = cloudflare_zero_trust_access_policy.owner.id, precedence = 1 },
  ]
}
