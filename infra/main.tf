terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.25"
    }
  }

  backend "s3" {}
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# The zone already exists and is shared with other projects. Terraform only reads it; the app's hostname is a
# Worker custom domain owned by wrangler (wrangler.jsonc `routes`), never a Terraform DNS record.
data "cloudflare_zone" "main" {
  filter = {
    name    = var.zone
    account = { id = var.cloudflare_account_id }
  }
}
