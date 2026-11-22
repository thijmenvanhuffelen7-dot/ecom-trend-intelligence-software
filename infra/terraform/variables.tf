variable "hcloud_token" {
  description = "Hetzner Cloud API-token (lezen/schrijven) — via TF_VAR_hcloud_token, nooit in een bestand"
  type        = string
  sensitive   = true
}

variable "location" {
  description = "Datacenter (EU: fsn1, nbg1, hel1)"
  type        = string
  default     = "fsn1"
}

variable "worker_server_type" {
  description = "Servertype voor workers + datastores (ClickHouse wil geheugen: minimaal 16 GB)"
  type        = string
  default     = "ccx23"
}

variable "worker_count" {
  description = "Aantal workerservers (de eerste draait ook beat en de datastores)"
  type        = number
  default     = 1
}

variable "ssh_public_key" {
  description = "Publieke SSH-sleutel voor beheer"
  type        = string
}

variable "admin_cidrs" {
  description = "IP-bereiken die SSH mogen (kantoor/VPN)"
  type        = list(string)
}

variable "data_volume_gb" {
  description = "Volume voor ClickHouse/Meilisearch/Redis-data"
  type        = number
  default     = 200
}

variable "worker_image" {
  description = "Container-image van de workers"
  type        = string
  default     = "ghcr.io/OWNER/trendscope-workers:latest"
}
