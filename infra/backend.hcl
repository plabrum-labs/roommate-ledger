# State lives in Cloudflare R2 through Terraform's S3 backend (R2 speaks the S3 API). Credentials come from
# AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, which CI derives from CLOUDFLARE_API_TOKEN (see terraform.yml).
# Passed with `terraform init -backend-config=backend.hcl`.
bucket = "plabrum-tf-state"
key    = "roommate-ledger/terraform.tfstate"
region = "auto"
endpoints = {
  s3 = "https://42ea0d21baf84d2a10e66a9ff0a421cc.r2.cloudflarestorage.com"
}
use_path_style              = true
use_lockfile                = true
skip_credentials_validation = true
skip_region_validation      = true
skip_requesting_account_id  = true
skip_metadata_api_check     = true
skip_s3_checksum            = true
