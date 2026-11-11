# Test-only OpenResty supplies nginx/Lua; production uses Ubuntu's nginx modules.
FROM openresty/openresty@sha256:4e73f525761f56b1256d2fabf1a70223b2f9f40788ef387e0ec8559f26ecb05b
RUN luarocks install lua-ffi-zlib 0.6-0 \
 && luarocks install lua-resty-openssl 1.9.0-1 \
 && luarocks install lua-resty-http 0.18.0-0 \
 && luarocks install lua-resty-session 4.2.0-1 \
 && luarocks install lua-resty-jwt 0.3.2-1 \
 && luarocks install lua-resty-openidc 1.8.0-1
