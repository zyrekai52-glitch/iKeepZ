#!/usr/bin/env bash
# Verifies the four release APKs produced by scripts/build_android.sh:
#   * package id and version are correct
#   * each per-ABI APK really contains only its own ABI (libflutter.so + libapp.so); universal contains all three
#   * the signature verifies (and says whether it is a debug signature)
#   * the four files are all different (never one APK renamed four times)
# Needs an Android SDK with build-tools (ANDROID_HOME / ANDROID_SDK_ROOT).
set -euo pipefail
cd "$(dirname "$0")/.."

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] || [ ! -d "$SDK/build-tools" ]; then
  echo "Set ANDROID_HOME to an Android SDK that has build-tools installed." >&2
  exit 1
fi
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -n 1)"
AAPT="$BT/aapt2"
[ -x "$AAPT" ] || AAPT="$BT/aapt"
APKSIGNER="$BT/apksigner"
echo "Using build-tools: $BT"

EXPECTED_ID="com.ikeepz.app"
EXPECTED_VERSION="$(sed -n 's/^version:[[:space:]]*\([0-9][0-9.]*\).*/\1/p' pubspec.yaml | head -n 1)"
echo "Expecting package $EXPECTED_ID, version $EXPECTED_VERSION"

failures=0
DEBUG_SIGNED=false

check_apk() {
  local name="$1" expected_abis="$2"
  local apk="release/iKeepZ-$name.apk"
  echo
  echo "== $apk"
  if [ ! -f "$apk" ]; then
    echo "FAIL: file is missing"
    return 1
  fi
  local badging id version abis
  badging="$("$AAPT" dump badging "$apk" 2>/dev/null)"
  id="$(printf '%s\n' "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p" | head -n 1)"
  version="$(printf '%s\n' "$badging" | sed -n "s/^package:.* versionName='\([^']*\)'.*/\1/p" | head -n 1)"
  abis="$(printf '%s\n' "$badging" | sed -n 's/^native-code: //p' | tr -d "'" | tr ' ' '\n' | sort | tr '\n' ' ' | sed 's/ $//')"
  echo "package=$id versionName=$version native-code=[$abis] size=$(stat -c %s "$apk") bytes"
  [ "$id" = "$EXPECTED_ID" ] || { echo "FAIL: package id is '$id'"; return 1; }
  [ "$version" = "$EXPECTED_VERSION" ] || { echo "FAIL: versionName is '$version'"; return 1; }
  local want
  want="$(printf '%s\n' $expected_abis | sort | tr '\n' ' ' | sed 's/ $//')"
  [ "$abis" = "$want" ] || { echo "FAIL: native-code is [$abis], expected [$want]"; return 1; }
  local listing abi lib
  listing="$(unzip -l "$apk")"
  for abi in $expected_abis; do
    for lib in libflutter.so libapp.so; do
      printf '%s\n' "$listing" | grep -q " lib/$abi/$lib\$" || { echo "FAIL: lib/$abi/$lib is missing"; return 1; }
    done
  done
  local certs
  if ! certs="$("$APKSIGNER" verify --print-certs "$apk" 2>&1)"; then
    echo "FAIL: signature does not verify"
    printf '%s\n' "$certs"
    return 1
  fi
  printf '%s\n' "$certs" | grep -E "Signer #1 certificate (DN|SHA-256 digest)" || true
  if printf '%s\n' "$certs" | grep -q "CN=Android Debug"; then
    DEBUG_SIGNED=true
  fi
  echo "OK"
}

check_apk arm64-v8a "arm64-v8a" || failures=$((failures + 1))
check_apk armeabi-v7a "armeabi-v7a" || failures=$((failures + 1))
check_apk x86_64 "x86_64" || failures=$((failures + 1))
check_apk universal "arm64-v8a armeabi-v7a x86_64" || failures=$((failures + 1))

echo
dupes="$(sha256sum release/iKeepZ-*.apk | awk '{print $1}' | sort | uniq -d)"
if [ -n "$dupes" ]; then
  echo "FAIL: two or more APKs are byte-identical ($dupes)"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed" >&2
  exit 1
fi
if [ "$DEBUG_SIGNED" = true ]; then
  echo "All APK checks passed. NOTE: the APKs are signed with the Android DEBUG key - fine for testing, not for publishing."
else
  echo "All APK checks passed and the APKs are signed with the configured release key."
fi
