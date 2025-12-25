# Web App Module
# Creates a public Google Cloud Storage bucket for SPA hosting with Load Balancer.

resource "google_storage_bucket" "web_app" {
  name     = "${var.bucket_name}-${var.environment}"
  location = var.region
  project  = var.project_id

  # Uniform bucket-level access (required for public access)
  uniform_bucket_level_access = true

  # SPA routing: serve index.html for all paths
  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
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

# URL map with SPA routing (404 fallback to index.html)
resource "google_compute_url_map" "web_app" {
  count           = var.enable_load_balancer ? 1 : 0
  name            = "intexuraos-web-${var.environment}-url-map"
  project         = var.project_id
  default_service = google_compute_backend_bucket.web_app[0].id

  # SPA fallback: return index.html for 404 errors (deep links)
  default_custom_error_response_policy {
    error_response_rule {
      match_response_codes   = ["404"]
      path                   = "/index.html"
      override_response_code = 200
    }
  }

  # Host rule for the domain
  host_rule {
    hosts        = [var.domain]
    path_matcher = "web-paths"
  }

  path_matcher {
    name            = "web-paths"
    default_service = google_compute_backend_bucket.web_app[0].id

    # SPA fallback for this path matcher
    custom_error_response_policy {
      error_response_rule {
        match_response_codes   = ["404"]
        path                   = "/index.html"
        override_response_code = 200
      }
    }

    # Static assets served directly (no rewrite, no SPA fallback)
    # Covers: Vite/React assets, fonts, icons, manifests, robots
    path_rule {
      paths = [
        "/assets/*",
        "/static/*",
        "/fonts/*",
        "/*.js",
        "/*.css",
        "/*.ico",
        "/*.png",
        "/*.svg",
        "/*.woff",
        "/*.woff2",
        "/favicon.ico",
        "/robots.txt",
        "/manifest.webmanifest",
      ]
      service = google_compute_backend_bucket.web_app[0].id
    }
  }
}

# Random suffix for SSL certificate (regenerates when domain changes)
resource "random_id" "cert_suffix" {
  count       = var.enable_load_balancer && var.domain != "" ? 1 : 0
  byte_length = 4

  keepers = {
    domain = var.domain
  }
}

# Google-managed SSL certificate
resource "google_compute_managed_ssl_certificate" "web_app" {
  count   = var.enable_load_balancer && var.domain != "" ? 1 : 0
  name    = "intexuraos-web-${var.environment}-cert-${random_id.cert_suffix[0].hex}"
  project = var.project_id

  managed {
    domains = [var.domain]
  }

  lifecycle {
    create_before_destroy = true
  }
}

# HTTPS proxy
resource "google_compute_target_https_proxy" "web_app" {
  count            = var.enable_load_balancer && var.domain != "" ? 1 : 0
  name             = "intexuraos-web-${var.environment}-https-proxy"
  project          = var.project_id
  url_map          = google_compute_url_map.web_app[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.web_app[0].id]
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

