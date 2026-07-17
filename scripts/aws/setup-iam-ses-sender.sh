#!/usr/bin/env bash
# setup-iam-ses-sender.sh — create a least-privilege IAM user that can ONLY
# send email via SES (no other AWS permissions). Prints access-key/secret pair
# to stdout once — copy them into AWS_SES_ACCESS_KEY_ID / AWS_SES_SECRET_ACCESS_KEY.
#
# Usage:
#   ./scripts/aws/setup-iam-ses-sender.sh [--user <username>]
#
# Defaults: username = "ses-sender". Idempotent for the user (won't recreate);
# but each run creates a NEW access-key pair, so don't run twice unless you
# want to rotate.

set -euo pipefail

USER="ses-sender"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found." >&2
  exit 1
fi

POLICY_NAME="${USER}-ses-send-only"

echo "==> Ensuring IAM user $USER exists…"
aws iam create-user --user-name "$USER" >/dev/null 2>&1 \
  && echo "    created" \
  || echo "    (already exists — continuing)"

echo "==> Attaching inline send-only policy…"
aws iam put-user-policy \
  --user-name "$USER" \
  --policy-name "$POLICY_NAME" \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "sesv2:SendEmail"
        ],
        "Resource": "*"
      }
    ]
  }' >/dev/null

echo "==> Creating access key (one-time secret reveal — capture now)…"
KEYJSON=$(aws iam create-access-key --user-name "$USER" --output json)
ACCESS_KEY_ID=$(echo "$KEYJSON" | grep -o '"AccessKeyId": "[^"]*"' | cut -d'"' -f4)
SECRET_KEY=$(echo "$KEYJSON" | grep -o '"SecretAccessKey": "[^"]*"' | cut -d'"' -f4)

echo
echo "============================================================"
echo "ADD THESE TO YOUR .env.local AND VERCEL ENV"
echo "============================================================"
echo "AWS_SES_ACCESS_KEY_ID=$ACCESS_KEY_ID"
echo "AWS_SES_SECRET_ACCESS_KEY=$SECRET_KEY"
echo "============================================================"
echo "Secret will NOT be retrievable again. Save it now."
echo "If you lose it, rotate via: aws iam create-access-key --user-name $USER"
echo "(then deactivate the lost one)."
