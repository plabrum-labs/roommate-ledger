# Copy both into wrangler.jsonc after the first apply (database_id, and vars.CF_ACCESS_AUD).
output "d1_database_id" {
  value = cloudflare_d1_database.main.id
}

output "access_aud" {
  value = cloudflare_zero_trust_access_application.app.aud
}

output "zone_id" {
  value = data.cloudflare_zone.main.zone_id
}
