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

# MCP server (docs/mcp-setup.md): its own self-hosted app on var.mcp_hostname so claude.ai's servers can reach it.
# Managed OAuth (beta) makes Access the OAuth authorization server (discovery, dynamic client registration, PKCE);
# the Worker verifies the Cf-Access-Jwt-Assertion against this app's AUD (MCP_ACCESS_AUD). Same owner policy and
# OTP identity provider as the main app. If `terraform validate` rejects `oauth_configuration` on the pinned
# provider, drop that block and enable Managed OAuth in the dashboard instead.
resource "cloudflare_zero_trust_access_application" "mcp" {
  account_id                = var.cloudflare_account_id
  name                      = "roommate-ledger mcp"
  type                      = "self_hosted"
  session_duration          = "720h"
  app_launcher_visible      = false
  allowed_idps              = [var.otp_idp_id]
  auto_redirect_to_identity = true
  destinations = [
    { type = "public", uri = var.mcp_hostname },
  ]
  policies = [
    { id = cloudflare_zero_trust_access_policy.owner.id, precedence = 1 },
  ]
  oauth_configuration = {
    enabled = true
    dynamic_client_registration = {
      enabled                = true
      allow_any_on_localhost = true # Claude Code (CLI) uses a localhost callback
      allow_any_on_loopback  = true
      allowed_uris = [
        "https://claude.ai/api/mcp/auth_callback",
        "https://chatgpt.com/connector_platform_oauth_redirect",
      ]
    }
    grant = {
      access_token_lifetime = "1h"
      session_duration      = "720h"
    }
  }
}
