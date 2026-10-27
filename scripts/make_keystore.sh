#!/usr/bin/env bash
# Creates a real Android release keystore (run ONCE, keep it and its passwords safe - losing it means you can never
# update the published app). Needs `keytool` (ships with any JDK).
#
# Usage: scripts/make_keystore.sh [output-file]      (default: ikeepz-release.keystore in the current directory)
#
# Afterwards add these GitHub Actions secrets so CI signs with it:
#   ANDROID_KEYSTORE_BASE64   = output of:  base64 -w0 ikeepz-release.keystore
#   ANDROID_KEYSTORE_PASSWORD = the store password you chose
#   ANDROID_KEY_ALIAS         = ikeepz
#   ANDROID_KEY_PASSWORD      = the same password (PKCS12 keystores use one password for store and key)
set -euo pipefail
OUT="${1:-ikeepz-release.keystore}"
if [ -e "$OUT" ]; then
  echo "$OUT already exists - refusing to overwrite." >&2
  exit 1
fi
keytool -genkeypair -v \
  -keystore "$OUT" -storetype PKCS12 \
  -alias ikeepz -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=iKeepZ, O=iKeepZ"
echo
echo "Created $OUT"
echo "Never commit it. Back it up somewhere safe, together with the password."
echo "Base64 for the GitHub secret:  base64 -w0 \"$OUT\""
