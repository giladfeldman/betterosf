# AWS SES bootstrap runbook

These three scripts stand up the AWS side of `add-email-auth` end-to-end. Run **once per project**, in order. Each is idempotent (safe to re-run).

## Prerequisites
- AWS CLI authenticated (`aws sts get-caller-identity` should succeed) with rights to create IAM users, SES identities, SNS topics, and SES configuration sets.
- A domain you control + access to its DNS provider.
- Your app's `/api/email/webhook` route deployed and publicly reachable (i.e. after `add-email-auth` is applied AND deployed to a real URL — `localhost` won't work for the SNS subscription).

## 1. Verify your sending domain
```bash
./scripts/aws/setup-ses-domain.sh example.com --region eu-west-1
```
Output: 3 DKIM CNAMEs + MX + SPF TXT + DMARC TXT records to add at your DNS provider.

**Manual step (cannot automate):** Add those records at your DNS provider (Route53, Cloudflare, Namecheap, etc.). DNS propagation usually takes a few minutes; can take up to 72 hours.

Verify with:
```bash
aws sesv2 get-email-identity --region eu-west-1 --email-identity example.com \
  --query '{DKIM:DkimAttributes.Status,MailFrom:MailFromAttributes.MailFromDomainStatus}'
```
Both should report `SUCCESS` once DNS propagates.

## 2. Create the IAM sender user
```bash
./scripts/aws/setup-iam-ses-sender.sh
```
Output: `AWS_SES_ACCESS_KEY_ID` + `AWS_SES_SECRET_ACCESS_KEY` (one-time secret reveal).

Paste both into your project's `.env.local` and into Vercel project env vars.

## 3. Wire bounce/complaint/delivery webhook
**After your app is deployed at a real URL** (Vercel preview or prod):
```bash
./scripts/aws/setup-sns-webhook.sh example.com https://example.com/api/email/webhook --region eu-west-1
```
Creates SNS topic + subscription + a SES configuration set. Sets `EMAIL_CONFIG_SET=ses-events-<your-domain>-config` — add this to your env.

`add-email-auth`'s `/api/email/webhook` route auto-confirms the SNS subscription on first POST (signature-verified via `sns-validator`).

## Out-of-sandbox (production access)
By default SES limits you to 200 emails/day and only verified recipients (the `@simulator.amazonses.com` allowlist works for tests). To send to real users you must request production access from the SES Console: **SES → Account dashboard → Request production access**. AWS approves within 24–48h for legitimate use cases.

## Cleanup
- IAM user: `aws iam delete-access-key --user-name ses-sender --access-key-id <id>` then `aws iam delete-user-policy --user-name ses-sender --policy-name ses-sender-ses-send-only` then `aws iam delete-user --user-name ses-sender`.
- SES identity: `aws sesv2 delete-email-identity --email-identity example.com --region eu-west-1`.
- SNS: `aws sns delete-topic --topic-arn <arn>`.
- DNS records: remove from your DNS provider.
