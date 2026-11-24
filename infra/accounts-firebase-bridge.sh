#!/usr/bin/env bash
# One-time setup: Verified signs in through accounts.mattrickslauer.com, then swaps the accounts
# access token for a Firebase custom token (POST /t/mattricks/v1/firebase/verified-99e74/token).
#
#   infra/accounts-firebase-bridge.sh            # run from anywhere; needs aws, git, node, npm
#
# Steps (each is safe to re-run):
#   1. ~/Code/accounts: new worktree + branch firebase-bridge from origin's default branch (p1-core), apply the patch, npm test
#   2. commit + push the branch (open a PR / merge it yourself afterwards)
#   3. store the verified-99e74 service-account key in SSM /accounts/firebase/mattricks/verified-99e74
#   4. deploy accounts from that worktree (infra/deploy.sh)
#   5. register Verified's clients on the mattricks tenant: verified-web (https) + verified-app (native scheme)
#   6. smoke test: the new endpoint answers 401 without a token
#
# Env overrides: ACCOUNTS_DIR, FIREBASE_KEY, AWS_REGION (default us-east-1), ALERT_EMAIL (optional, deploy.sh)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH="$HERE/accounts-firebase-bridge.patch"
ACC="${ACCOUNTS_DIR:-$HOME/Code/accounts}"
WT="$(dirname "$ACC")/accounts-firebase-bridge"
BRANCH=firebase-bridge
TENANT=mattricks
PROJECT=verified-99e74
KEY="${FIREBASE_KEY:-$(ls "$HOME"/Documents/AuthCodes/verified-99e74-firebase-adminsdk-*.json 2>/dev/null | head -1)}"
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
BASE=https://accounts.mattrickslauer.com

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
[ -f "$PATCH" ] || { echo "missing $PATCH" >&2; exit 1; }
[ -f "$KEY" ] || { echo "service-account key not found (set FIREBASE_KEY=/path/to/key.json)" >&2; exit 1; }
node -e 'const k=require(process.argv[1]); if (k.project_id!==process.argv[2]||!k.private_key||!k.client_email) process.exit(1)' "$KEY" "$PROJECT" \
  || { echo "$KEY is not a service-account key for $PROJECT" >&2; exit 1; }
aws sts get-caller-identity --query Account --output text >/dev/null || { echo "aws CLI not signed in" >&2; exit 1; }

say "1. accounts worktree $WT ($BRANCH)"
git -C "$ACC" fetch -q origin
git -C "$ACC" remote set-head origin --auto >/dev/null
BASE_REF="$(git -C "$ACC" symbolic-ref --short refs/remotes/origin/HEAD)"   # accounts' default branch (p1-core)
echo "base: $BASE_REF ($(git -C "$ACC" rev-parse --short "$BASE_REF"))"
if [ ! -d "$WT" ]; then
  git -C "$ACC" worktree add -q -b "$BRANCH" "$WT" "$BASE_REF"
fi
cd "$WT"
if git apply --check "$PATCH" 2>/dev/null; then
  git apply "$PATCH"
  echo "patch applied"
elif git apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "patch already applied"
elif git apply -3 "$PATCH"; then
  echo "patch applied with a 3-way merge"
else
  echo "patch does not apply to $BASE_REF. Send me: git -C $ACC log --oneline -5 $BASE_REF" >&2; exit 1
fi
npm ci --no-audit --no-fund --silent
npm test 2>&1 | tail -4

say "2. commit + push $BRANCH"
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Firebase bridge: swap an access token for a Firebase custom token; app-scheme redirects make native clients"
fi
git push -q -u origin "$BRANCH" || echo "(push failed; the deploy below still works from this worktree)"

say "3. SSM /accounts/firebase/$TENANT/$PROJECT"
aws ssm put-parameter --name "/accounts/firebase/$TENANT/$PROJECT" --type SecureString --overwrite \
  --value "file://$KEY" --query Version --output text | sed 's/^/version /'

say "4. deploy accounts"
./infra/deploy.sh

say "5. register Verified clients on tenant $TENANT"
node bin/accounts client add "$TENANT" verified-web --name "Verified" \
  --redirect "https://$PROJECT.web.app/" --redirect "https://$PROJECT.firebaseapp.com/" --redirect "http://localhost:5173/" \
  --origin "https://$PROJECT.web.app" --origin "https://$PROJECT.firebaseapp.com" --origin "http://localhost:5173"
node bin/accounts client add "$TENANT" verified-app --name "Verified" \
  --redirect "com.mattricks.verified:/oauth2redirect"
node bin/accounts client list "$TENANT" | grep -E "verified-(web|app)" || true

say "6. smoke test"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/t/$TENANT/v1/firebase/$PROJECT/token")"
echo "POST /t/$TENANT/v1/firebase/$PROJECT/token without a token → $code (want 401)"
[ "$code" = 401 ] && echo "bridge is live" || { echo "unexpected: the deploy may not have picked up the change" >&2; exit 1; }

say "done: merge $BRANCH in accounts when you're happy (git -C $ACC worktree remove $WT afterwards)"
