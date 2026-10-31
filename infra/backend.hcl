# State lives in Cloudflare R2 through Terraform's S3 backend (R2 speaks the S3 API). Credentials are an R2 API
# token's S3 key pair, read from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (org secrets R2_ACCESS_KEY_ID /
# R2_SECRET_ACCESS_KEY in CI). Passed with `terraform init -backend-config=backend.hcl`.
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
