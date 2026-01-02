# Web App Module
# Creates a public Google Cloud Storage bucket for SPA hosting with Load Balancer.
#
# LIMITATION: GCP backend buckets don't support SPA deep-link fallback (404 -> index.html).
# The bucket's website.main_page_suffix works for / -> index.html.
# For deep links (/settings, /dashboard), users must navigate from / first,
# or use hash-based routing (#/settings).

resource "google_storage_bucket" "web_app" {
  name     = "${var.bucket_name}-${var.environment}"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access (required for public access)
  uniform_bucket_level_access = true

  # Website configuration
  # main_page_suffix: serves index.html when accessing /
  # not_found_page: NOT effective through Load Balancer, only for direct GCS access
  website {
    main_page_suffix = "index.html"
  }

  # CORS configuration for API calls
  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  labels = var.labels

  # Versioning for rollback capability
  versioning {
    enabled = true
  }

  # Lifecycle rule to clean up old versions
  lifecycle_rule {
    condition {
      num_newer_versions = 5
    }
    action {
      type = "Delete"
    }
  }
}

# Make bucket publicly readable
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.web_app.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# -----------------------------------------------------------------------------
# Load Balancer for SPA Hosting
# -----------------------------------------------------------------------------

# Reserve a global static IP address
resource "google_compute_global_address" "web_app" {
  count   = var.enable_load_balancer ? 1 : 0
  name    = "intexuraos-web-${var.environment}-ip"
  project = var.project_id
}

# Backend bucket pointing to the GCS bucket
# NOTE: Cache policy relies on origin headers. Upload strategy:
#   - index.html: Cache-Control: no-cache, max-age=0, must-revalidate
#   - assets/*:   Cache-Control: public, max-age=31536000, immutable
resource "google_compute_backend_bucket" "web_app" {
  count       = var.enable_load_balancer ? 1 : 0
  name        = "intexuraos-web-${var.environment}-backend"
  project     = var.project_id
  bucket_name = google_storage_bucket.web_app.name
  enable_cdn  = true

  cdn_policy {
    cache_mode       = "USE_ORIGIN_HEADERS"
    negative_caching = true
  }

  # Custom response headers
  custom_response_headers = [
    "X-Frame-Options: DENY",
    "X-Content-Type-Options: nosniff",
  ]
}

# URL map for SPA hosting
# NOTE: This is a simple pass-through URL map. All requests go to the backend bucket.
# The bucket serves files as-is. For SPA deep links to work:
#   - Navigate to / first, then use client-side routing
#   - Or use hash-based routing (#/settings instead of /settings)
# GCP backend buckets don't support proper SPA fallback (rewrite to index.html).
resource "google_compute_url_map" "web_app" {
  count   = var.enable_load_balancer ? 1 : 0
  name    = "intexuraos-web-${var.environment}-url-map"
  project = var.project_id

  default_service = google_compute_backend_bucket.web_app[0].id

  # IMPORTANT: GCS website properties (main_page_suffix) are NOT applied when using
  # a backend bucket behind the external HTTP(S) Load Balancer. Without an explicit
  # rewrite, GET / will try to fetch an empty object name and return 404.
  host_rule {
    hosts        = var.domain != "" ? [var.domain] : ["*"]
    path_matcher = "web-app"
  }

  path_matcher {
    name            = "web-app"
    default_service = google_compute_backend_bucket.web_app[0].id

    # Rewrite root requests to the actual object.
    path_rule {
      paths = ["/"]

      route_action {
        url_rewrite {
          path_prefix_rewrite = "/index.html"
        }
      }

      service = google_compute_backend_bucket.web_app[0].id
    }
  }
}

# -----------------------------------------------------------------------------
# SSL Certificates
# -----------------------------------------------------------------------------

# Random suffix for managed SSL certificate (regenerates when domain changes)
resource "random_id" "cert_suffix" {
  count       = var.enable_load_balancer && var.domain != "" && !var.use_custom_certificate ? 1 : 0
  byte_length = 4

  keepers = {
    domain = var.domain
  }
}

# Google-managed SSL certificate (used when use_custom_certificate = false)
resource "google_compute_managed_ssl_certificate" "web_app" {
  count   = var.enable_load_balancer && var.domain != "" && !var.use_custom_certificate ? 1 : 0
  name    = "intexuraos-web-${var.environment}-cert-${random_id.cert_suffix[0].hex}"
  project = var.project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# Read private key from Secret Manager (for custom certificate)
data "google_secret_manager_secret_version" "ssl_key" {
  count   = var.use_custom_certificate ? 1 : 0
  secret  = var.ssl_private_key_secret_id
  project = var.project_id
}

# Self-managed SSL certificate (used when use_custom_certificate = true)
resource "google_compute_ssl_certificate" "custom" {
  count       = var.enable_load_balancer && var.domain != "" && var.use_custom_certificate ? 1 : 0
  name        = "intexuraos-web-${var.environment}-cert"
  project     = var.project_id
  certificate = file(var.ssl_certificate_path)
  private_key = data.google_secret_manager_secret_version.ssl_key[0].secret_data

  lifecycle {
    create_before_destroy = true
  }
}

# HTTPS proxy
resource "google_compute_target_https_proxy" "web_app" {
  count   = var.enable_load_balancer && var.domain != "" ? 1 : 0
  name    = "intexuraos-web-${var.environment}-https-proxy"
  project = var.project_id
  url_map = google_compute_url_map.web_app[0].id
  ssl_certificates = [
    var.use_custom_certificate
    ? google_compute_ssl_certificate.custom[0].id
    : google_compute_managed_ssl_certificate.web_app[0].id
  ]
}

# HTTP proxy (for redirect to HTTPS)
resource "google_compute_target_http_proxy" "web_app" {
  count   = var.enable_load_balancer ? 1 : 0
  name    = "intexuraos-web-${var.environment}-http-proxy"
  project = var.project_id
  url_map = google_compute_url_map.web_app_redirect[0].id
}

# URL map for HTTP to HTTPS redirect
resource "google_compute_url_map" "web_app_redirect" {
  count   = var.enable_load_balancer ? 1 : 0
  name    = "intexuraos-web-${var.environment}-redirect"
  project = var.project_id

  default_url_redirect {
    https_redirect         = true
    strip_query            = false
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
  }
}

# HTTPS forwarding rule
resource "google_compute_global_forwarding_rule" "web_app_https" {
  count                 = var.enable_load_balancer && var.domain != "" ? 1 : 0
  name                  = "intexuraos-web-${var.environment}-https"
  project               = var.project_id
  ip_address            = google_compute_global_address.web_app[0].address
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "443"
  target                = google_compute_target_https_proxy.web_app[0].id
}

# HTTP forwarding rule (redirects to HTTPS)
resource "google_compute_global_forwarding_rule" "web_app_http" {
  count                 = var.enable_load_balancer ? 1 : 0
  name                  = "intexuraos-web-${var.environment}-http"
  project               = var.project_id
  ip_address            = google_compute_global_address.web_app[0].address
  ip_protocol           = "TCP"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  port_range            = "80"
  target                = google_compute_target_http_proxy.web_app[0].id
}
