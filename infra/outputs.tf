# Copy these into wrangler.jsonc after an apply (database_id, vars.CF_ACCESS_AUD, vars.MCP_ACCESS_AUD).
output "d1_database_id" {
  value = cloudflare_d1_database.main.id
}

output "access_aud" {
  value = cloudflare_zero_trust_access_application.app.aud
}

output "mcp_access_aud" {
  description = "MCP_ACCESS_AUD in wrangler.jsonc vars (the mcp hostname's Access app)"
  value       = cloudflare_zero_trust_access_application.mcp.aud
}

output "zone_id" {
  value = data.cloudflare_zone.main.zone_id
}
