variable "cloudflare_api_token" {
  description = "Cloudflare API token (org secret CLOUDFLARE_API_TOKEN in CI)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the zone, the Worker and the D1 database"
  type        = string
}

variable "zone" {
  description = "Existing Cloudflare zone the app lives under"
  type        = string
}

variable "hostname" {
  description = "Public hostname of the app (a Worker custom domain in wrangler.jsonc)"
  type        = string
}

variable "allowed_emails" {
  description = "Emails allowed through Cloudflare Access"
  type        = list(string)
}
