# The pet leaderboard

A public board of the best-fed Claude Code pets, and private boards for teams. A pet only appears after its
owner types `/pet board join` or joins a team, and it sends only its name, its animal, how much it ate, and
what it owns.

## What is in here

| Path | What it is |
|---|---|
| `api/handler.py` | The whole backend: one function that reads the board, takes a pet's report, and removes a pet. |
| `api/test_handler.py` | Its tests. `cd leaderboard/api && python3 -m unittest` |
| `web/index.html` | The page people look at. With no API address set, it shows example pets. |
| `template.yaml` | Everything the board needs on AWS, written down so it can be created in one go. |
| `deploy.sh` | Creates or updates all of it. |

## How it runs on AWS

- **API Gateway (HTTP API)** takes the requests and enforces a speed limit. Requests over the limit are turned away.
- **Lambda** runs `handler.py` for each request. Nothing runs between requests.
- **DynamoDB** holds one row per pet, billed per read and write. An index keeps pets sorted, so the top 100 is one read.
  A second index does the same for each team.
- **S3 + CloudFront** serve the page. The bucket is private; only CloudFront can read it.
- **AWS Budgets** emails you when the month's bill passes $5 and $10, if you give an address.

## Why lying cannot win

Nothing a pet reports can be proven, because the count comes from its owner's computer. So:

- The board keeps its own score. A pet's belly holds one day of food, so its score grows by at most 1M tokens a day.
- A pet may bring at most 250k tokens with it when it joins.
- Days fed and streaks are counted by the board's clock.
- Ties go to whoever joined first.
- The board rolls the luck. Whether a pet is shiny, and what it finds while it eats, is decided by the board's
  own dice. Hats for eating and for streaks are checked against the board's own count. Only three small things
  are taken on the pet's word: the bandage, the sweatband and the bow.
- One network can hatch 20 new pets a day (`JoinsPerNetwork` in the template), so nobody rolls for a shiny a
  thousand times. The board keeps a scrambled form of the network address for two days to count this.
- Only a pet's owner can report for it. Any pet can be hidden by setting `hidden` to true on its row.

## Teams

A team is a code its members share, like `acme-k3x9q2ab`: the team's name, a dash, and eight random
characters. Nothing has to be set up on the board first. `GET /board?team=<code>` returns that team's pets,
and the page shows them at `?team=<code>`. Whoever has the code can see the team and join it; nobody else can.
A pet can be on a team without being on the public board.

Someone who fakes their numbers can at best draw level with a devoted honest player. First place earns a
crown in the game and nothing else.

## Putting it live

Needs the AWS CLI, signed in to your account.

```
ALERT_EMAIL=you@example.com leaderboard/deploy.sh
```

It prints the page's address and the API's address. Put those two in `BOARD_API` and `BOARD_PAGE` near the
top of `claude-plugin/vramagotchi/hooks/register.tsx`.

To take it all down again: `aws cloudformation delete-stack --stack-name vramagotchi-board` (empty the page bucket first).
