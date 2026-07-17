#!/usr/bin/env bash
# setup-ses-domain.sh — verify a sending domain in AWS SES and print the DNS
# records you must add at your DNS provider (Route53, Cloudflare, Namecheap…).
#
# Usage:
#   ./scripts/aws/setup-ses-domain.sh <domain> [--region <aws-region>]
#
# Idempotent: safe to re-run. Prints the records to stdout each time.
#
# What this does in AWS:
#   1. Creates an "Email Identity" for the domain (DKIM enabled).
#   2. Sets MAIL FROM to mail.<domain> (improves deliverability).
#   3. Returns the 3 DKIM CNAMEs + the SPF TXT + the MX/SPF for the MAIL FROM
#      subdomain. You add these to your DNS.
#
# What this does NOT do:
#   - Touch your DNS provider. DKIM/SPF/DMARC propagation is on you.
#   - Move you out of SES sandbox. Open a Support case from the Console for
#     production-access (required to send to addresses you don't own).

set -euo pipefail

DOMAIN="${1:-}"
REGION="${AWS_SES_REGION:-eu-west-1}"
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

if [[ -z "$DOMAIN" ]]; then
  echo "usage: setup-ses-domain.sh <domain> [--region <aws-region>]" >&2
  exit 64
fi

echo "==> Region: $REGION"
echo "==> Domain: $DOMAIN"

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found. Install from https://aws.amazon.com/cli/" >&2
  exit 1
fi

echo
echo "==> Creating SES email identity (idempotent)…"
# Default = Easy DKIM (AWS auto-manages keys; produces 3 CNAMEs).
# Do NOT pass --dkim-signing-attributes; that flag is for BYODKIM only and requires
# DomainSigningSelector + DomainSigningPrivateKey TOGETHER (omitting one fails).
if ! aws sesv2 create-email-identity \
      --region "$REGION" \
      --email-identity "$DOMAIN" \
      >/dev/null 2>create-err.log; then
  if grep -qiE "already exists?|AlreadyExistsException" create-err.log; then
    echo "    (already exists — continuing)"
  else
    echo "    FAILED — see create-err.log"; cat create-err.log; rm -f create-err.log; exit 1
  fi
fi
rm -f create-err.log

echo
echo "==> Setting MAIL FROM domain to mail.$DOMAIN…"
aws sesv2 put-email-identity-mail-from-attributes \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --mail-from-domain "mail.$DOMAIN" \
  --behavior-on-mx-failure "USE_DEFAULT_VALUE" \
  >/dev/null

echo
echo "==> Fetching DKIM tokens…"
DKIM_TOKENS=$(aws sesv2 get-email-identity \
  --region "$REGION" \
  --email-identity "$DOMAIN" \
  --query 'DkimAttributes.Tokens' --output json)

echo
echo "============================================================"
echo "ADD THESE DNS RECORDS AT YOUR DNS PROVIDER"
echo "============================================================"
echo
echo "DKIM (CNAME, 3 records):"
echo "$DKIM_TOKENS" | tr -d '[]"' | tr ',' '\n' | while read -r token; do
  token_trim="$(echo "$token" | xargs)"
  [[ -z "$token_trim" ]] && continue
  echo "  Host:   ${token_trim}._domainkey.${DOMAIN}"
  echo "  Value:  ${token_trim}.dkim.amazonses.com"
  echo
done

echo "MAIL FROM domain (MX + TXT/SPF):"
echo "  Host:   mail.${DOMAIN}"
echo "  Type:   MX"
echo "  Value:  10 feedback-smtp.${REGION}.amazonses.com"
echo
echo "  Host:   mail.${DOMAIN}"
echo "  Type:   TXT"
echo "  Value:  \"v=spf1 include:amazonses.com ~all\""
echo

echo "DMARC (recommended; aligns with SPF/DKIM):"
echo "  Host:   _dmarc.${DOMAIN}"
echo "  Type:   TXT"
echo "  Value:  \"v=DMARC1; p=quarantine; rua=mailto:dmarc@${DOMAIN}\""
echo

echo "============================================================"
echo "After DNS propagates (~minutes to a few hours):"
echo "  aws sesv2 get-email-identity --region $REGION \\"
echo "    --email-identity $DOMAIN \\"
echo "    --query '{DKIMVerified:DkimAttributes.Status,MailFromVerified:MailFromAttributes.MailFromDomainStatus}'"
echo "Both should report SUCCESS / PENDING (PENDING is fine until DNS propagates)."
echo "============================================================"
