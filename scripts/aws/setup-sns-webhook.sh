#!/usr/bin/env bash
# setup-sns-webhook.sh — create an SNS topic, subscribe your /api/email/webhook
# endpoint, and wire SES bounce/complaint/delivery notifications to it.
#
# Usage:
#   ./scripts/aws/setup-sns-webhook.sh <domain> <webhook-url> [--region <r>]
# Example:
#   ./scripts/aws/setup-sns-webhook.sh example.com https://example.com/api/email/webhook
#
# Idempotent for topic + subscription. The subscription requires manual
# confirmation: SNS POSTs a SubscriptionConfirmation to your webhook on
# creation. /api/email/webhook auto-confirms it (verifies SNS signature).

set -euo pipefail

DOMAIN="${1:-}"
WEBHOOK_URL="${2:-}"
REGION="${AWS_SES_REGION:-eu-west-1}"
shift 2 2>/dev/null || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --region) REGION="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 64 ;;
  esac
done

if [[ -z "$DOMAIN" || -z "$WEBHOOK_URL" ]]; then
  echo "usage: setup-sns-webhook.sh <domain> <webhook-url> [--region <r>]" >&2
  exit 64
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found." >&2
  exit 1
fi

TOPIC_NAME="ses-events-$(echo "$DOMAIN" | tr '.' '-')"
echo "==> Region: $REGION"
echo "==> Topic:  $TOPIC_NAME"
echo "==> Hook:   $WEBHOOK_URL"

echo
echo "==> Creating SNS topic (idempotent)…"
TOPIC_ARN=$(aws sns create-topic --region "$REGION" --name "$TOPIC_NAME" --query 'TopicArn' --output text)
echo "    arn: $TOPIC_ARN"

echo
echo "==> Subscribing webhook URL (idempotent — re-subscription is a no-op)…"
SUB_ARN=$(aws sns subscribe \
  --region "$REGION" \
  --topic-arn "$TOPIC_ARN" \
  --protocol https \
  --notification-endpoint "$WEBHOOK_URL" \
  --return-subscription-arn \
  --query 'SubscriptionArn' --output text)
echo "    sub: $SUB_ARN"
echo "    NOTE: SNS just POSTed a SubscriptionConfirmation to your webhook."
echo "    /api/email/webhook from add-email-auth auto-confirms via signature check."

echo
echo "==> Wiring SES bounce + complaint + delivery → SNS topic…"
for EVENT in BOUNCE COMPLAINT DELIVERY; do
  aws sesv2 put-email-identity-feedback-attributes \
    --region "$REGION" \
    --email-identity "$DOMAIN" \
    --email-forwarding-enabled \
    >/dev/null 2>&1 || true

  # Configuration set approach (preferred over identity-level): create one
  # named "$TOPIC_NAME-config" and attach a SNS event-destination.
  CONFIG_SET="${TOPIC_NAME}-config"
  aws sesv2 create-configuration-set --region "$REGION" --configuration-set-name "$CONFIG_SET" 2>/dev/null || true
  aws sesv2 create-configuration-set-event-destination \
    --region "$REGION" \
    --configuration-set-name "$CONFIG_SET" \
    --event-destination-name "$EVENT-to-sns" \
    --event-destination "Enabled=true,MatchingEventTypes=$EVENT,SnsDestination={TopicArn=$TOPIC_ARN}" \
    2>/dev/null \
    && echo "    + $EVENT → SNS" \
    || echo "    ($EVENT destination already exists — continuing)"
done

echo
echo "============================================================"
echo "Send mail with the configuration set header to flow events:"
echo "  X-SES-CONFIGURATION-SET: ${TOPIC_NAME}-config"
echo "(add-email-auth's send.ts already does this via EMAIL_CONFIG_SET env."
echo " Set EMAIL_CONFIG_SET=${TOPIC_NAME}-config in .env.local + Vercel.)"
echo "============================================================"
