"""The pet leaderboard's whole backend: one function behind an HTTP API, and one table.

    GET    /board        the top pets, and with ?id=... that pet's own place
    POST   /pets         a pet joins, or reports what it has eaten since last time
    DELETE /pets         a pet leaves

Nothing a pet reports can be proven: the count comes from its owner's computer. So the board is built
so that lying cannot win:

  - The board keeps its own score. A pet's belly holds one day of food, so however much a pet claims,
    its score grows by at most BELLY a day. The heaviest honest users reach that; nobody passes it.
  - Days fed and streaks are counted here, by the board's own clock. They cannot be claimed.
  - Ties go to the pet that joined first. Someone who lies can at best draw level with a devoted
    honest player who started earlier, never overtake them.
  - Only a pet's owner can report for it, and any pet can be hidden by hand.

It is still a game with nothing worth money in it, and it should stay that way.
"""
import hashlib
import hmac
import json
import os
import re
import time

STAGES = (("baby", 0), ("kid", 25_000), ("teen", 250_000), ("adult", 2_500_000), ("legend", 25_000_000))
MILESTONES = {"headphones": 10_000, "wizard": 100_000, "crown": 1_000_000, "tophat": 10_000_000}
ITEMS = set(MILESTONES) | {"bandage", "sweatband", "flame", "bow", "flower", "sprout", "propeller", "halo", "star"}

HEAD_START = 250_000          # the most a pet may bring with it when it joins
BELLY = 1_000_000             # the most a pet can eat in one day; it empties at this pace too
EPOCH = 10 ** 10              # room for a join time (in seconds) beside the score, to break ties
WAIT = 60                     # seconds a pet must leave between two reports
TOP = 100
FRESH = 30                    # seconds the board is remembered before it is read again

ID = re.compile(r"^[a-f0-9]{32}$")
KEY = re.compile(r"^[a-f0-9]{32,64}$")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ]{0,11}$")


class Refused(Exception):
    def __init__(self, status, why):
        super().__init__(why)
        self.status, self.why = status, why


class Dynamo:
    """The table. One row per pet; an index named "board" keeps them sorted by `place`."""

    def __init__(self):
        import boto3
        from boto3.dynamodb.conditions import Key
        self.table, self.Key = boto3.resource("dynamodb").Table(os.environ["TABLE"]), Key

    def get(self, pet_id):
        return self.table.get_item(Key={"id": pet_id}).get("Item")

    def put(self, row, was=None):
        """Write a row only if nobody else wrote it meanwhile. `was` is the `updated` time we read."""
        from botocore.exceptions import ClientError
        try:
            if was is None:
                self.table.put_item(Item=row, ConditionExpression="attribute_not_exists(id)")
            else:
                self.table.put_item(Item=row, ConditionExpression="updated = :was", ExpressionAttributeValues={":was": was})
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise Refused(409, "try again") from None
            raise

    def delete(self, pet_id):
        self.table.delete_item(Key={"id": pet_id})

    def top(self, count):
        found = self.table.query(IndexName="board", KeyConditionExpression=self.Key("board").eq("all"),
                                 ScanIndexForward=False, Limit=count)
        return found["Items"]


store = None                  # made on first use; the tests put their own here
remembered = {"at": 0.0, "rows": []}


def lock(key):
    return hashlib.sha256(key.encode()).hexdigest()


def stage_of(score):
    return [name for name, at in STAGES if score >= at][-1]


def place(score, joined):
    """One number to sort by: score first, and between equal scores the earlier joiner is higher."""
    return score * EPOCH + (EPOCH - 1 - joined)


def shown(row, rank):
    """What the public sees of a pet. Never its id or its key."""
    score = int(row["score"])
    wearing = row.get("wearing")
    if wearing in MILESTONES and score < MILESTONES[wearing]:
        wearing = None          # a hat it has not earned on the board's own count
    return {"rank": rank, "name": row["name"], "score": score, "stage": stage_of(score), "shiny": bool(row.get("shiny")),
            "wearing": wearing, "streak": int(row.get("streak", 0)), "days": int(row.get("days", 0)), "joined": int(row["joined"])}


def board(now):
    if now - remembered["at"] > FRESH:
        rows = [row for row in store.top(TOP + 20) if not row.get("hidden")][:TOP]
        remembered.update(at=now, rows=[shown(row, i + 1) for i, row in enumerate(rows)])
    return remembered["rows"]


def rank_of(row, now):
    """A pet's place if it is on the board, else None. Counting every pet above it would cost more the bigger the board got."""
    rows = board(now)
    mine = (int(row["score"]), -int(row["joined"]))
    ahead = sum(1 for other in rows if (other["score"], -other["joined"]) > mine)
    return ahead + 1 if ahead < TOP else None


def checked(body):
    """The parts of a report, or Refused. Anything not on this list is dropped."""
    if not isinstance(body, dict):
        raise Refused(400, "send a JSON object")
    pet_id, key, name, lifetime = body.get("id"), body.get("key"), body.get("name"), body.get("lifetime")
    if not (isinstance(pet_id, str) and ID.match(pet_id) and isinstance(key, str) and KEY.match(key)):
        raise Refused(400, "bad id or key")
    if not (isinstance(name, str) and NAME.match(name.strip())):
        raise Refused(400, "a name is 1 to 12 letters, digits or spaces")
    if isinstance(lifetime, bool) or not isinstance(lifetime, (int, float)) or not 0 <= lifetime < 1e15:
        raise Refused(400, "bad lifetime")
    items = body.get("items") if isinstance(body.get("items"), list) else []
    items = sorted({item for item in items if isinstance(item, str) and item in ITEMS})
    wearing = body.get("wearing") if body.get("wearing") in items else None
    return {"id": pet_id, "key": key, "name": name.strip(), "lifetime": int(lifetime), "items": items, "wearing": wearing,
            "shiny": body.get("shiny") is True}


def report(body, now):
    seen = checked(body)
    now = int(now)
    row = store.get(seen["id"])
    if row is None:
        eaten = min(seen["lifetime"], HEAD_START)
        row = {"id": seen["id"], "lock": lock(seen["key"]), "board": "all", "joined": now, "score": eaten, "belly": BELLY - eaten,
               "counted": seen["lifetime"], "days": 0, "streak": 0, "fed": -1}
        was, left_over = None, seen["lifetime"] > eaten
    else:
        if not hmac.compare_digest(str(row["lock"]), lock(seen["key"])):
            raise Refused(403, "that is not your pet")
        was = row["updated"]
        if now - int(was) < WAIT:
            raise Refused(429, "too soon")
        belly = min(BELLY, int(row["belly"]) + (now - int(was)) * BELLY // 86_400)
        wanted = max(0, seen["lifetime"] - int(row["counted"]))
        eaten = min(wanted, belly)
        row = dict(row, score=int(row["score"]) + eaten, belly=belly - eaten, counted=max(int(row["counted"]), seen["lifetime"]))
        left_over = wanted > eaten
    today = now // 86_400
    if eaten > 0 and int(row["fed"]) != today:          # days and streaks run on the board's clock, not the pet's word
        row.update(days=int(row["days"]) + 1, streak=int(row["streak"]) + 1 if int(row["fed"]) == today - 1 else 1, fed=today)
    row.update(name=seen["name"], items=seen["items"], wearing=seen["wearing"], shiny=seen["shiny"], updated=now,
               place=place(int(row["score"]), int(row["joined"])))
    store.put(row, was)
    if was is None:
        remembered["at"] = 0.0      # a new pet: read the board again so it shows up at once
    return {"score": row["score"], "stage": stage_of(row["score"]), "rank": rank_of(row, now), "streak": row["streak"],
            "days": row["days"], "full": left_over}


def leave(body):
    if not isinstance(body, dict) or not isinstance(body.get("id"), str) or not isinstance(body.get("key"), str):
        raise Refused(400, "bad id or key")
    row = store.get(body["id"]) if ID.match(body["id"]) else None
    if row is None:
        return {"left": True}
    if not hmac.compare_digest(str(row["lock"]), lock(body["key"])):
        raise Refused(403, "that is not your pet")
    store.delete(body["id"])
    return {"left": True}


def answer(status, body, cache=0):
    return {"statusCode": status, "headers": {"content-type": "application/json", "cache-control": f"public, max-age={cache}" if cache else "no-store"},
            "body": json.dumps(body, separators=(",", ":"))}


def handle(event, context=None, now=None):
    global store
    if store is None:
        store = Dynamo()
    now = now or time.time()
    method, path = event["requestContext"]["http"]["method"], event.get("rawPath", "/").rstrip("/")
    try:
        if method == "GET" and path == "/board":
            out = {"pets": board(now), "rules": {"headStart": HEAD_START, "perDay": BELLY}}
            pet_id = (event.get("queryStringParameters") or {}).get("id", "")
            row = store.get(pet_id) if ID.match(pet_id) else None
            if row is not None:
                out["you"] = shown(row, rank_of(row, now))
                return answer(200, out)
            return answer(200, out, cache=FRESH)
        if path == "/pets" and method in ("POST", "DELETE"):
            raw = event.get("body") or ""
            if len(raw) > 4096:
                raise Refused(413, "too big")
            try:
                body = json.loads(raw)
            except ValueError:
                raise Refused(400, "send JSON") from None
            return answer(200, report(body, now) if method == "POST" else leave(body))
        raise Refused(404, "nothing here")
    except Refused as no:
        return answer(no.status, {"error": no.why})
