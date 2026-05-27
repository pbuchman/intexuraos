local cjson = require("cjson.safe")
local openidc = require("resty.openidc")

local EXPECTED_ISS = "https://accounts.google.com"
local EXPECTED_AUD = "https://intexuraos.cloud"
local INTERNAL_AUTH_TOKEN_FILE = "/etc/intexuraos/internal-auth-token"
local ALLOWED_SERVICE_ACCOUNTS = {
  ["intexuraos-scheduler-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-whatsapp-svc-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-commands-agents-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-actions-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-research-agent-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-calendar-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-bookmarks-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-todos-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
  ["intexuraos-code-dev@intexuraos-dev-pbuchman.iam.gserviceaccount.com"] = true,
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

if type(claims.email) ~= "string" or not ALLOWED_SERVICE_ACCOUNTS[claims.email] then
  ngx.log(ngx.WARN, "Google OIDC service account is not allowed")
  return deny(ngx.HTTP_FORBIDDEN, "forbidden_service_account")
end

local internal_auth_token = read_internal_auth_token()
if internal_auth_token == nil then
  return deny(ngx.HTTP_INTERNAL_SERVER_ERROR, "internal_auth_token_unavailable")
end

ngx.req.clear_header("Authorization")
ngx.req.clear_header("X-Internal-Auth")
ngx.req.clear_header("Cookie")
ngx.req.clear_header("From")
ngx.var.edge_internal_auth_token = internal_auth_token
