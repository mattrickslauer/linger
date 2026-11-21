#!/usr/bin/env bash
# One-time Firebase setup for Linger. Idempotent: safe to re-run.
#
#   npx --prefix web firebase login      # once, in your own terminal
#   gcloud auth login                    # once, same Google account
#   ./infra/setup-firebase.sh [project-id]
#
# Creates (or reuses) the project and web app, enables the APIs, creates a reCAPTCHA Enterprise
# key and an App Check debug token, and writes:
#   web/.env.local              Firebase config + reCAPTCHA key (all modes)
#   web/.env.development.local  App Check debug token (dev server only, never in a build)
#   .firebaserc                 default project
# Two console steps remain; the script prints them at the end.

set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fb() { npx --prefix "$repo/web" firebase "$@"; }

project="${1:-linger-reader-$(date +%m%d)}"
echo "Project: $project"

if ! fb login:list 2>/dev/null | grep -q "Logged in as"; then
  echo "error: run 'npx --prefix web firebase login' first" >&2
  exit 1
fi

if fb projects:list --json | node -e 'const p=JSON.parse(require("fs").readFileSync(0)).result||[];process.exit(p.some(x=>x.projectId===process.argv[1])?0:1)' "$project"; then
  echo "Using existing project"
else
  fb projects:create "$project" --display-name "Linger"
fi

app_id="$(fb apps:list WEB --project "$project" --json | node -e 'const a=(JSON.parse(require("fs").readFileSync(0)).result||[]).find(x=>x.displayName==="Linger web");console.log(a?a.appId:"")')"
if [ -z "$app_id" ]; then
  fb apps:create WEB "Linger web" --project "$project" >/dev/null
  app_id="$(fb apps:list WEB --project "$project" --json | node -e 'const a=(JSON.parse(require("fs").readFileSync(0)).result||[]).find(x=>x.displayName==="Linger web");console.log(a.appId)')"
fi
echo "Web app: $app_id"

echo "Enabling APIs…"
gcloud services enable \
  firebasevertexai.googleapis.com generativelanguage.googleapis.com \
  firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com \
  firebaseremoteconfig.googleapis.com firebasehosting.googleapis.com \
  --project "$project"

site_key="$(gcloud recaptcha keys list --project "$project" --format='value(name)' --filter='displayName=linger-web' 2>/dev/null | head -1 | sed 's#.*/##')"
if [ -z "$site_key" ]; then
  site_key="$(gcloud recaptcha keys create --project "$project" --display-name=linger-web --web \
    --integration-type=score --domains="localhost,$project.web.app,$project.firebaseapp.com" \
    --format='value(name)' | sed 's#.*/##')"
fi
echo "reCAPTCHA Enterprise key: $site_key"

fb apps:sdkconfig WEB "$app_id" --project "$project" --json | SITE_KEY="$site_key" node -e '
  const c = JSON.parse(require("fs").readFileSync(0)).result.sdkConfig;
  const lines = [
    "# Written by infra/setup-firebase.sh",
    `VITE_FIREBASE_API_KEY=${c.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${c.authDomain}`,
    `VITE_FIREBASE_PROJECT_ID=${c.projectId}`,
    `VITE_FIREBASE_STORAGE_BUCKET=${c.storageBucket ?? ""}`,
    `VITE_FIREBASE_MESSAGING_SENDER_ID=${c.messagingSenderId}`,
    `VITE_FIREBASE_APP_ID=${c.appId}`,
    `VITE_RECAPTCHA_ENTERPRISE_KEY=${process.env.SITE_KEY}`,
  ];
  require("fs").writeFileSync(process.argv[1], lines.join("\n") + "\n");
' "$repo/web/.env.local"

dev_env="$repo/web/.env.development.local"
if ! grep -q VITE_APPCHECK_DEBUG_TOKEN "$dev_env" 2>/dev/null; then
  token="$(node -e 'console.log(crypto.randomUUID())')"
  fb appcheck:debugtokens:create "$token" --app "$app_id" --display-name "linger-dev" --project "$project" -f >/dev/null
  printf 'VITE_APPCHECK_DEBUG=true\nVITE_APPCHECK_DEBUG_TOKEN=%s\n' "$token" > "$dev_env"
fi

printf '{\n  "projects": { "default": "%s" }\n}\n' "$project" > "$repo/.firebaserc"

cat <<EOF

Done. Wrote web/.env.local, web/.env.development.local and .firebaserc.

Two steps left in the console (https://console.firebase.google.com/project/$project):
  1. AI Logic → Get started → choose "Gemini Developer API".
  2. App Check → Apps → Linger web → register with reCAPTCHA Enterprise, site key:
       $site_key
     Then App Check → APIs → Firebase AI Logic → Enforce (after you have tested locally).

Then:
  cd web && npm run dev                      # local, uses the debug token
  npm run build && cd .. && npx --prefix web firebase deploy --only hosting,remoteconfig
EOF
