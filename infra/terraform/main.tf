# Skelet: workers + datastores op Hetzner Cloud (EU). De web-app draait op Vercel, Postgres bij voorkeur managed.
# Gebruik:  cd infra/terraform && terraform init && terraform plan -var-file=prod.tfvars

resource "hcloud_ssh_key" "admin" {
  name       = "trendscope-admin"
  public_key = var.ssh_public_key
}

resource "hcloud_network" "private" {
  name     = "trendscope"
  ip_range = "10.20.0.0/16"
}

resource "hcloud_network_subnet" "private" {
  network_id   = hcloud_network.private.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.20.1.0/24"
}

# Alleen SSH vanaf beheer-IP's; datastores zijn niet publiek bereikbaar (alleen via het private netwerk)
resource "hcloud_firewall" "workers" {
  name = "trendscope-workers"
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.admin_cidrs
  }
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "worker" {
  count        = var.worker_count
  name         = "trendscope-worker-${count.index + 1}"
  server_type  = var.worker_server_type
  image        = "ubuntu-24.04"
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.admin.id]
  firewall_ids = [hcloud_firewall.workers.id]
  labels       = { app = "trendscope", role = count.index == 0 ? "primary" : "worker" }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    worker_image = var.worker_image
    primary      = count.index == 0
  })

  network {
    network_id = hcloud_network.private.id
    ip         = "10.20.1.${count.index + 10}"
  }

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }

  depends_on = [hcloud_network_subnet.private]
}

resource "hcloud_volume" "data" {
  name      = "trendscope-data"
  size      = var.data_volume_gb
  location  = var.location
  format    = "ext4"
  automount = false
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.worker[0].id
  automount = true
}
