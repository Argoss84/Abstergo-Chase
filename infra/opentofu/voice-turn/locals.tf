locals {
  user_data = <<-EOT
    #!/bin/bash
    set -euxo pipefail
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y coturn
    cat >/etc/turnserver.conf <<CONF
    listening-port=3478
    tls-listening-port=5349
    fingerprint
    use-auth-secret
    static-auth-secret=${var.turn_secret}
    realm=${var.turn_realm}
    total-quota=100
    bps-capacity=0
    stale-nonce=600
    no-loopback-peers
    no-multicast-peers
    min-port=${var.relay_min_port}
    max-port=${var.relay_max_port}
    no-cli
    CONF
    sed -i 's/^#TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
    systemctl enable coturn
    systemctl restart coturn
  EOT
}
