#!/usr/bin/env bash
# Puts the leaderboard on AWS, or updates it. Run from anywhere:
#
#     ALERT_EMAIL=you@example.com leaderboard/deploy.sh
#
# It creates real resources in your AWS account. See README.md for what they are and what they cost.
set -euo pipefail
cd "$(dirname "$0")"

STACK=${STACK:-vramagotchi-board}
REGION=${AWS_REGION:-us-east-1}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
UPLOADS=vramagotchi-uploads-$ACCOUNT-$REGION        # where the function's code is kept for CloudFormation

aws s3api head-bucket --bucket "$UPLOADS" 2>/dev/null || aws s3 mb "s3://$UPLOADS" --region "$REGION"
aws cloudformation package --region "$REGION" --template-file template.yaml --s3-bucket "$UPLOADS" --output-template-file .packaged.yaml
aws cloudformation deploy --region "$REGION" --stack-name "$STACK" --template-file .packaged.yaml \
    --capabilities CAPABILITY_IAM CAPABILITY_AUTO_EXPAND --parameter-overrides AlertEmail="${ALERT_EMAIL:-}"

output() { aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
API=$(output ApiUrl); PAGE=$(output PageUrl); BUCKET=$(output PageBucketName)

# The page is written without its outer tags so it can also be previewed as it is. Add them, and tell it where the API lives.
{ printf '<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
  sed "s|^const API = ''|const API = '$API'|" web/index.html; } > .index.html
grep -q "const API = '$API'" .index.html
aws s3 cp .index.html "s3://$BUCKET/index.html" --content-type 'text/html; charset=utf-8' --cache-control 'max-age=300'
rm -f .index.html .packaged.yaml

echo
echo "Board page:  $PAGE"
echo "Board API:   $API"
echo "Now set BOARD_API and BOARD_PAGE near the top of claude-plugin/vramagotchi/hooks/register.tsx to those two."
