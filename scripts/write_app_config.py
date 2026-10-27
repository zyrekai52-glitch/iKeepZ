#!/usr/bin/env python3
"""Write config/app_config.json from environment variables (used by CI).

Usage: write_app_config.py [android|windows]

Values come from GitHub Actions secrets exposed as environment variables. The script never prints values.
Set ALLOW_UNCONFIGURED=true to build even when required values are missing; the resulting app then shows
its "Configuration required" screen instead of connecting to Firebase.
"""
import json
import os
import sys

KEYS = [
    "FIREBASE_API_KEY",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_MESSAGING_SENDER_ID",
    "FIREBASE_STORAGE_BUCKET",
    "FIREBASE_APP_ID_ANDROID",
    "FIREBASE_APP_ID_WINDOWS",
    "FIREBASE_AUTH_DOMAIN",
    "API_BASE_URL",
    "SUPPORT_EMAIL",
    "PRIVACY_URL",
    "RELEASES_URL",
]

REQUIRED = {
    "android": [
        "FIREBASE_API_KEY",
        "FIREBASE_PROJECT_ID",
        "FIREBASE_MESSAGING_SENDER_ID",
        "FIREBASE_APP_ID_ANDROID",
        "API_BASE_URL",
    ],
    "windows": [
        "FIREBASE_API_KEY",
        "FIREBASE_PROJECT_ID",
        "FIREBASE_MESSAGING_SENDER_ID",
        "FIREBASE_APP_ID_WINDOWS",
        "API_BASE_URL",
    ],
}


def main() -> int:
    platform = sys.argv[1] if len(sys.argv) > 1 else "android"
    if platform not in REQUIRED:
        print(f"::error::unknown platform '{platform}'")
        return 2
    allow = os.environ.get("ALLOW_UNCONFIGURED", "").strip().lower() in ("1", "true", "yes")
    cfg = {key: os.environ.get(key, "").strip() for key in KEYS}
    base = cfg["API_BASE_URL"]
    if base.endswith("/"):
        cfg["API_BASE_URL"] = base.rstrip("/")
    missing = [key for key in REQUIRED[platform] if not cfg[key]]
    if missing and not allow:
        print("::error title=Missing configuration::These GitHub secrets are empty: " + ", ".join(missing))
        print("Add them under Settings > Secrets and variables > Actions, or run the workflow with allow_unconfigured=true "
              "to produce a build that only shows the 'Configuration required' screen.")
        return 1
    if missing:
        print("::warning title=Unconfigured build::Building without: " + ", ".join(missing))
    os.makedirs("config", exist_ok=True)
    with open(os.path.join("config", "app_config.json"), "w", encoding="utf-8") as handle:
        json.dump(cfg, handle, indent=2)
        handle.write("\n")
    configured = [key for key in KEYS if cfg[key]]
    print(f"Wrote config/app_config.json with {len(configured)} of {len(KEYS)} keys set (values not shown).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
