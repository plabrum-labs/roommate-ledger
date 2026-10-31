# S3 state backend, passed with `terraform init -backend-config=backend.hcl` (CI and `just infra-init`).
bucket       = "tf-state-plabrum"
key          = "roommate-ledger/terraform.tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
