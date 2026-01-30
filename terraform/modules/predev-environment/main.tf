# Pre-Dev Environment - Compute Resources

locals {
  mig_name = "predev-mig-${var.environment}"
}

# VM Instance Template
resource "google_compute_instance_template" "predev" {
  name_prefix  = "predev-template-"
  machine_type = "e2-medium"
  region       = var.region

  scheduling {
    preemptible                 = true
    automatic_restart           = false
    on_host_maintenance         = "TERMINATE"
    provisioning_model          = "SPOT"
    instance_termination_action = "STOP"
  }

  disk {
    source_image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
    disk_size_gb = 20
    disk_type    = "pd-ssd"
    auto_delete  = true
    boot         = true
  }

  network_interface {
    network = "default"
    access_config {}
  }

  metadata = {
    startup-script = file("${path.module}/scripts/startup.sh")
  }

  service_account {
    email  = google_service_account.predev_vm.email
    scopes = ["cloud-platform"]
  }

  tags = ["predev", "http-server"]

  lifecycle {
    create_before_destroy = true
  }
}

# Managed Instance Group (0-1 scaling)
resource "google_compute_instance_group_manager" "predev" {
  name               = local.mig_name
  base_instance_name = "predev"
  zone               = var.zone
  target_size        = 0

  version {
    instance_template = google_compute_instance_template.predev.id
  }

  named_port {
    name = "http"
    port = 3000
  }
}

# Firewall - Allow traffic to pre-dev VM
resource "google_compute_firewall" "predev_allow_http" {
  name    = "predev-allow-http-${var.environment}"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3000", "8105", "8106", "8110-8128"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["predev"]
}
