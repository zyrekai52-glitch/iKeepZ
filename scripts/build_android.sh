#!/usr/bin/env bash
# Local equivalent of the CI Android build. Requires Flutter 3.47.x, the Android SDK and Java 17+.
# Output: release/iKeepZ-{arm64-v8a,armeabi-v7a,x86_64,universal}.apk  (+ SHA256SUMS.txt)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f config/app_config.json ]; then
  echo "config/app_config.json is missing. Copy config/app_config.example.json to config/app_config.json and fill it in." >&2
  exit 1
fi
if [ ! -f android/key.properties ]; then
  echo "NOTE: android/key.properties not found - APKs will be signed with the DEBUG key (fine for testing, never publish)." >&2
fi

DEFINES="--dart-define-from-file=config/app_config.json"
OUT=build/app/outputs/flutter-apk
mkdir -p release
rm -f release/iKeepZ-*.apk release/SHA256SUMS.txt

flutter pub get
flutter build apk --release --split-per-abi $DEFINES
cp "$OUT/app-arm64-v8a-release.apk"   release/iKeepZ-arm64-v8a.apk
cp "$OUT/app-armeabi-v7a-release.apk" release/iKeepZ-armeabi-v7a.apk
cp "$OUT/app-x86_64-release.apk"      release/iKeepZ-x86_64.apk

flutter build apk --release $DEFINES
cp "$OUT/app-release.apk" release/iKeepZ-universal.apk

(cd release && sha256sum iKeepZ-*.apk | tee SHA256SUMS.txt)
echo "Done. APKs are in release/."
