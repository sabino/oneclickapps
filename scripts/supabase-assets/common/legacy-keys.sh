#!/bin/sh
set -eu

base64url_encode() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

sign_supabase_hs256_jwt() {
  role="$1"
  now="$(date +%s)"
  exp="$((now + 60 * 60 * 24 * 365 * 5))"
  header='{"alg":"HS256","typ":"JWT"}'
  payload="$(printf '{"role":"%s","iss":"supabase-self-hosted","iat":%s,"exp":%s}' "$role" "$now" "$exp")"

  header_b64="$(printf '%s' "$header" | base64url_encode)"
  payload_b64="$(printf '%s' "$payload" | base64url_encode)"
  signing_input="${header_b64}.${payload_b64}"
  signature="$(
    printf '%s' "$signing_input" |
      openssl dgst -sha256 -hmac "$JWT_SECRET" -binary |
      base64url_encode
  )"

  printf '%s.%s.%s' "$header_b64" "$payload_b64" "$signature"
}

ensure_supabase_legacy_keys() {
  : "${JWT_SECRET:?JWT_SECRET is required}"

  if [ -z "${SUPABASE_ANON_KEY:-}" ]; then
    export SUPABASE_ANON_KEY="$(sign_supabase_hs256_jwt anon)"
  fi

  if [ -z "${SUPABASE_SERVICE_KEY:-}" ]; then
    export SUPABASE_SERVICE_KEY="$(sign_supabase_hs256_jwt service_role)"
  fi

  if [ -z "${ANON_KEY:-}" ]; then
    export ANON_KEY="$SUPABASE_ANON_KEY"
  fi

  if [ -z "${SERVICE_KEY:-}" ]; then
    export SERVICE_KEY="$SUPABASE_SERVICE_KEY"
  fi

  if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    export SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_KEY"
  fi

  if [ -z "${SUPABASE_PUBLISHABLE_KEYS:-}" ]; then
    export SUPABASE_PUBLISHABLE_KEYS="$(printf '{"default":"%s"}' "$SUPABASE_ANON_KEY")"
  fi

  if [ -z "${SUPABASE_SECRET_KEYS:-}" ]; then
    export SUPABASE_SECRET_KEYS="$(printf '{"default":"%s"}' "$SUPABASE_SERVICE_KEY")"
  fi
}
