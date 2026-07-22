local cjson = require("cjson.safe")
local openidc = require("resty.openidc")

local EXPECTED_ISS = "https://accounts.google.com"
local EXPECTED_AUD = "https://intexuraos.cloud"
local INTERNAL_AUTH_TOKEN_FILE = "/etc/intexuraos/internal-auth-token"
local EVALUATOR_ROUTE_PREFIX = "/internal/evals/"
local GLOBAL_ALLOWED_SERVICE_ACCOUNTS = {
  ["intexuraos-scheduler-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-whatsapp-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-research-agent-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-calendar-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-bookmarks-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-intex-agent-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
}

local ROUTE_ALLOWED_SERVICE_ACCOUNTS = {
  ["/internal/whatsapp/private/events"] = {
    ["intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  },
  ["/internal/whatsapp/private/media"] = {
    ["intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  },
  ["/internal/whatsapp/private/media/backfill"] = {
    ["intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  },
  ["/internal/whatsapp/pubsub/process-webhook"] = {
    ["intexuraos-whatsapp-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  },
}

local ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS = {
  {
    pattern = [[^/internal/evals/(?:whatsapp|intex-agent)/matrix-corpus(?:/|$)]],
    caller_role = "matrix_corpus_runner",
    allowed_service_accounts = {
      ["claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
    },
  },
  {
    pattern = [[^/internal/evals/whatsapp/whatsapp/private/outbound-matrix-messages$]],
    caller_role = "matrix_corpus_runner",
    allowed_methods = { POST = true },
    allowed_service_accounts = {
      ["claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
    },
  },
  {
    pattern = [[^/internal/evals/intex-agent/test-runs/[^/]+/(?:projection|artifact-delivery)$]],
    caller_role = "matrix_corpus_runner",
    allowed_methods = { PUT = true },
    allowed_service_accounts = {
      ["claude-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
    },
  },
  {
    pattern = [[^/internal/whatsapp/private/accounts/[^/]+/erasure(?:/[^/]+)?$]],
    caller_role = "whatsapp_private_sync",
    allowed_service_accounts = {
      ["intexuraos-wa-private-sync-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
    },
  },
}

local ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS = {
  ["/internal/users/"] = {
    ["ixos-transcription-fn-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  },
}

local opts = {
  discovery = "https://accounts.google.com/.well-known/openid-configuration",
  jwk_expires_in = 3600,
  ssl_verify = "yes",
  accept_unsupported_alg = false,
  accept_none_alg = false,
  token_signing_alg_values_expected = { "RS256" },
}

local function deny(status, reason, detail)
  ngx.status = status
  ngx.header["Content-Type"] = "application/json"
  local body = { error = reason }
  if detail ~= nil then
    body.detail = detail
  end
  ngx.say(cjson.encode(body))
  return ngx.exit(status)
end

local function read_internal_auth_token()
  local file, err = io.open(INTERNAL_AUTH_TOKEN_FILE, "r")
  if file == nil then
    ngx.log(ngx.ERR, "failed to open internal auth token file: ", err or "unknown")
    return nil
  end

  local token = file:read("*a")
  file:close()

  if token == nil then
    return nil
  end

  token = token:gsub("%s+$", "")
  if token == "" then
    return nil
  end

  return token
end

local function is_service_account_allowed(email)
  local route_allowed_service_accounts = ROUTE_ALLOWED_SERVICE_ACCOUNTS[ngx.var.uri]
  if route_allowed_service_accounts ~= nil then
    return route_allowed_service_accounts[email] == true, nil
  end

  for _, route_pattern in ipairs(ROUTE_PATTERN_ALLOWED_SERVICE_ACCOUNTS) do
    if ngx.re.match(ngx.var.uri, route_pattern.pattern, "jo") ~= nil then
      local request_method = ngx.req.get_method()
      local method_allowed = route_pattern.allowed_methods == nil
        or route_pattern.allowed_methods[request_method] == true
      local allowed = method_allowed and route_pattern.allowed_service_accounts[email] == true
      return allowed, allowed and route_pattern.caller_role or nil
    end
  end

  if string.sub(ngx.var.uri, 1, string.len(EVALUATOR_ROUTE_PREFIX)) ==
      EVALUATOR_ROUTE_PREFIX then
    return false, nil
  end

  for prefix, route_prefix_allowed_service_accounts in pairs(ROUTE_PREFIX_ALLOWED_SERVICE_ACCOUNTS) do
    if string.sub(ngx.var.uri, 1, string.len(prefix)) == prefix then
      return route_prefix_allowed_service_accounts[email] == true, nil
    end
  end

  return GLOBAL_ALLOWED_SERVICE_ACCOUNTS[email] == true, nil
end

local auth_header = ngx.var.http_authorization
if auth_header == nil then
  return deny(ngx.HTTP_UNAUTHORIZED, "missing_authorization_header")
end

local _, _, token = string.find(auth_header, "^Bearer%s+(.+)$")
if token == nil then
  return deny(ngx.HTTP_UNAUTHORIZED, "malformed_authorization_header")
end

local claims, err = openidc.bearer_jwt_verify(opts)
if err ~= nil or claims == nil then
  ngx.log(ngx.WARN, "Google OIDC JWT verification failed: ", err or "no claims")
  return deny(ngx.HTTP_UNAUTHORIZED, "invalid_token")
end

if claims.iss ~= EXPECTED_ISS then
  ngx.log(ngx.WARN, "Google OIDC issuer mismatch")
  return deny(ngx.HTTP_UNAUTHORIZED, "invalid_issuer")
end

local aud_ok = false
if type(claims.aud) == "string" then
  aud_ok = claims.aud == EXPECTED_AUD
elseif type(claims.aud) == "table" then
  for _, audience in ipairs(claims.aud) do
    if audience == EXPECTED_AUD then
      aud_ok = true
      break
    end
  end
end

if not aud_ok then
  ngx.log(ngx.WARN, "Google OIDC audience mismatch")
  return deny(ngx.HTTP_UNAUTHORIZED, "invalid_audience")
end

local service_account_allowed = false
local caller_role = nil
if type(claims.email) == "string" then
  service_account_allowed, caller_role = is_service_account_allowed(claims.email)
end

if not service_account_allowed then
  ngx.log(ngx.WARN, "Google OIDC service account is not allowed")
  return deny(ngx.HTTP_FORBIDDEN, "forbidden_service_account")
end

local internal_auth_token = read_internal_auth_token()
if internal_auth_token == nil then
  return deny(ngx.HTTP_INTERNAL_SERVER_ERROR, "internal_auth_token_unavailable")
end

ngx.req.clear_header("Authorization")
ngx.req.clear_header("X-Internal-Auth")
ngx.req.clear_header("X-Internal-Caller-Role")
ngx.req.clear_header("Cookie")
ngx.req.clear_header("From")
ngx.var.edge_internal_auth_token = internal_auth_token
ngx.var.edge_internal_caller_role = caller_role or ""
