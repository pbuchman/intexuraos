locals {
  repo_root = abspath("${path.module}/../..")

  bootstrap_source_hash = sha256(join("", [
    filesha256("${local.repo_root}/package.json"),
    filesha256("${local.repo_root}/pnpm-lock.yaml"),
    filesha256("${local.repo_root}/pnpm-workspace.yaml"),
    filesha256("${local.repo_root}/ecosystem.config.prod.cjs"),
    filesha256("${local.repo_root}/scripts/hetzner/provision.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/load-secrets.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/install-nginx-and-cert.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/deploy-nginx.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/deploy-web.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/reload-pm2.sh"),
    filesha256("${local.repo_root}/scripts/hetzner/nginx/intexuraos.conf"),
    filesha256("${local.repo_root}/scripts/hetzner/nginx/jwt-verify.lua"),
    filesha256("${local.repo_root}/terraform/certs/intexuraos.cloud/fullchain.pem"),
  ]))

  ssh_common_args = "-i ${pathexpand(var.deploy_ssh_private_key_path)} -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
}

resource "terraform_data" "bootstrap_prod" {
  count = var.hetzner_bootstrap_enabled ? 1 : 0

  triggers_replace = {
    server_id             = hcloud_server.prod.id
    bootstrap_source_hash = local.bootstrap_source_hash
  }

  depends_on = [
    hcloud_server.prod,
  ]

  connection {
    type        = "ssh"
    user        = "root"
    host        = hcloud_primary_ip.prod_ipv4.ip_address
    private_key = file(pathexpand(var.deploy_ssh_private_key_path))
    timeout     = "10m"
  }

  provisioner "remote-exec" {
    inline = [
      "cloud-init status --wait || true",
      "install -d -o deploy -g deploy -m 755 /opt/intexuraos /var/www/intexuraos/web/dist",
      "install -d -o deploy -g deploy -m 700 /home/deploy/.ssh",
      "printf '%s\\n' '${var.deploy_ssh_public_key}' > /home/deploy/.ssh/authorized_keys",
      "chown deploy:deploy /home/deploy/.ssh /home/deploy/.ssh/authorized_keys",
      "chmod 700 /home/deploy/.ssh",
      "chmod 600 /home/deploy/.ssh/authorized_keys",
      "printf '%s\\n' 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-intexuraos-deploy",
      "chmod 0440 /etc/sudoers.d/90-intexuraos-deploy",
    ]
  }

  provisioner "file" {
    source      = pathexpand(var.provisioner_sa_key_path)
    destination = "/tmp/intexuraos-provisioner-sa-key.json"
  }

  provisioner "file" {
    source      = pathexpand(var.runtime_sa_key_path)
    destination = "/tmp/intexuraos-runtime-sa-key.json"
  }

  provisioner "remote-exec" {
    inline = [
      "install -m 600 -o deploy -g deploy /tmp/intexuraos-provisioner-sa-key.json /home/deploy/provisioner-sa-key.json",
      "install -m 600 -o deploy -g deploy /tmp/intexuraos-runtime-sa-key.json /home/deploy/runtime-sa-key.json",
      "rm -f /tmp/intexuraos-provisioner-sa-key.json /tmp/intexuraos-runtime-sa-key.json",
    ]
  }

  provisioner "local-exec" {
    interpreter = ["/usr/bin/env", "bash", "-lc"]
    command     = <<-EOT
      set -euo pipefail
      rsync -az --delete \
        --exclude '.git/' \
        --exclude '.terraform/' \
        --exclude '.env*' \
        --exclude 'node_modules/' \
        --exclude 'dist/' \
        --exclude 'coverage/' \
        --exclude '*.tfstate' \
        --exclude '*.tfstate.*' \
        -e 'ssh ${local.ssh_common_args}' \
        '${local.repo_root}/' 'deploy@${hcloud_primary_ip.prod_ipv4.ip_address}:/opt/intexuraos/'
    EOT
  }

  provisioner "remote-exec" {
    inline = [
      "cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/provision.sh --skip-certbot",
      "sudo -iu deploy bash -lc 'cd /opt/intexuraos && CI=true pnpm install --frozen-lockfile'",
    ]
  }

  provisioner "local-exec" {
    interpreter = ["/usr/bin/env", "bash", "-lc"]
    command     = <<-EOT
      set -euo pipefail
      commit_sha="$(git -C '${local.repo_root}' rev-parse HEAD)"
      commit_message="$(git -C '${local.repo_root}' log -1 --pretty=%s)"
      printf -v commit_sha_quoted '%q' "$commit_sha"
      printf -v commit_message_quoted '%q' "$commit_message"
      ssh ${local.ssh_common_args} deploy@${hcloud_primary_ip.prod_ipv4.ip_address} \
        "cd /opt/intexuraos && COMMIT_SHA=$commit_sha_quoted COMMIT_MESSAGE=$commit_message_quoted INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-web.sh"
    EOT
  }

  provisioner "remote-exec" {
    inline = [
      "sudo -iu deploy bash -lc 'cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/reload-pm2.sh'",
      "cd /opt/intexuraos && INTEXURAOS_ENVIRONMENT=prod bash scripts/hetzner/deploy-nginx.sh",
    ]
  }
}
