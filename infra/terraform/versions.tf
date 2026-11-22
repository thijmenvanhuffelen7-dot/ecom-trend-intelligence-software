terraform {
  required_version = ">= 1.6"
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.49" }
  }
  # Zet state remote vóór productie (bv. een S3-compatibele bucket bij Hetzner Object Storage):
  # backend "s3" { bucket = "trendscope-tfstate" key = "prod/terraform.tfstate" region = "fsn1" endpoint = "https://fsn1.your-objectstorage.com" skip_credentials_validation = true skip_region_validation = true use_path_style = true }
}

provider "hcloud" {
  token = var.hcloud_token
}
