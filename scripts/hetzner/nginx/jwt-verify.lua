-- /etc/nginx/lua/jwt-verify.lua
-- Verifies Google-issued OIDC JWTs for Pub/Sub push endpoints (INT-750 Phase 7).
--
-- Replaces Cloud Run's native OIDC verification for the Hetzner deployment.
-- Pub/Sub push messages arrive with an Authorization: Bearer <JWT> header.
-- The JWT is signed by Google's JWKS at
--   https://www.googleapis.com/oauth2/v3/certs
-- (discovered via https://accounts.google.com/.well-known/openid-configuration)
-- and the subscription's oidc_token.audience field determines the expected
-- `aud` claim. See terraform/environments/prod/pubsub.tf for subscription
-- audience configuration (audience = https://intexuraos.cloud).
--
-- Security model enforced here (fail closed on any mismatch):
--   1. Must have Authorization: Bearer <token>
--   2. Signature verified via lua-resty-openidc against Google's JWKS (RS256 only)
--   3. iss == https://accounts.google.com
--   4. aud == https://intexuraos.cloud
--   5. exp not in the past (openidc handles this)
--
-- After verification, the Authorization header is stripped before forwarding
-- to upstream so downstream services never see the raw token.

local openidc = require("resty.openidc")
local cjson   = require("cjson.safe")

-- Reused across requests via lua-resty-openidc's internal caching on
-- lua_shared_dict (configured at http-level in intexuraos.conf).
local opts = {
  discovery = "https://accounts.google.com/.well-known/openid-configuration",
  jwk_expires_in = 3600,           -- cache JWKS for 1 hour
  ssl_verify = "yes",
  accept_unsupported_alg = false,
  accept_none_alg = false,
  token_signing_alg_values_expected = { "RS256" },
}

local EXPECTED_ISS = "https://accounts.google.com"
local EXPECTED_AUD = "https://intexuraos.cloud"

-- Helper: terminate with a JSON 401 body
local function deny(reason, detail)
  ngx.status = 401
  ngx.header["Content-Type"] = "application/json"
  local body = { error = reason }
  if detail then body.detail = detail end
  ngx.say(cjson.encode(body))
  return ngx.exit(ngx.HTTP_UNAUTHORIZED)
end

-- 1. Extract Bearer token
local auth_header = ngx.var.http_authorization
if not auth_header then
  return deny("missing_authorization_header")
end

local _, _, token = string.find(auth_header, "^Bearer%s+(.+)$")
if not token then
  return deny("malformed_authorization_header")
end

-- 2. Verify signature + exp via lua-resty-openidc (uses openid-config discovery)
local claims, err = openidc.bearer_jwt_verify(opts)
if err or not claims then
  ngx.log(ngx.WARN, "JWT verification failed: ", err or "no claims")
  return deny("invalid_token", err or "unknown")
end

-- 3. Enforce issuer
if claims.iss ~= EXPECTED_ISS then
  ngx.log(ngx.WARN, "JWT iss mismatch: got=", tostring(claims.iss), " want=", EXPECTED_ISS)
  return deny("invalid_issuer")
end

-- 4. Enforce audience (may be string or array per RFC 7519)
local aud_ok = false
if type(claims.aud) == "string" then
  aud_ok = claims.aud == EXPECTED_AUD
elseif type(claims.aud) == "table" then
  for _, a in ipairs(claims.aud) do
    if a == EXPECTED_AUD then
      aud_ok = true
      break
    end
  end
end

if not aud_ok then
  local aud_str = cjson.encode(claims.aud)
  ngx.log(ngx.WARN, "JWT aud mismatch: got=", aud_str, " want=", EXPECTED_AUD)
  return deny("invalid_audience")
end

-- 5. All checks passed — strip Authorization before forwarding
ngx.req.clear_header("Authorization")
