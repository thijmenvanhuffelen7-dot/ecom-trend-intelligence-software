output "worker_ipv4" {
  value = hcloud_server.worker[*].ipv4_address
}

output "worker_private_ip" {
  value = [for s in hcloud_server.worker : one(s.network[*].ip)]
}

output "data_volume_device" {
  value = hcloud_volume.data.linux_device
}
