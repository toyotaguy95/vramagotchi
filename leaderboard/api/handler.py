"""The pet leaderboard's whole backend: one function behind an HTTP API, and one table.

    GET    /board        the top pets; with ?id=... that pet's own place; with ?team=... that team's pets
    POST   /pets         a pet joins, or reports what it has eaten since last time
    DELETE /pets         a pet leaves

Nothing a pet reports can be proven: the count comes from its owner's computer. So the board is built
so that lying cannot win:

  - The board keeps its own score. A pet's belly holds one day of food, so however much a pet claims,
    its score grows by at most BELLY a day. The heaviest honest users reach that; nobody passes it.
  - Days fed and streaks are counted here, by the board's own clock. They cannot be claimed.
  - Ties go to the pet that joined first. Someone who lies can at best draw level with a devoted
    honest player who started earlier, never overtake them.
  - Luck is rolled here. Whether a pet is shiny, and what it finds while it eats, is decided by the
    board's own dice. A hat for eating or for a streak is checked against the board's own count.
  - One network can only hatch so many new pets a day, so nobody rolls for a shiny a thousand times.
  - Only a pet's owner can report for it, and any pet can be hidden by hand.

A team is a code its members share, like "acme-k3x9q2ab". Whoever has the code can join the team and
see its board; nobody else can. A pet can be on a team without being on the public board.

It is still a game with nothing worth money in it, and it should stay that way.
"""
import hashlib
import hmac
import json
import ipaddress
import os
import random
import re
import time

STAGES = (("baby", 0), ("kid", 25_000), ("teen", 250_000), ("adult", 2_500_000), ("legend", 25_000_000))
MILESTONES = {"headphones": 10_000, "wizard": 100_000, "crown": 1_000_000, "tophat": 10_000_000}
DEEDS = {"bandage", "sweatband", "bow"}      # small things only the pet's own computer can know; taken on its word
FINDS = {"common": ("flower", "sprout"), "rare": ("propeller", "halo"), "legendary": ("star",)}
FIND_ODDS = 0.005             # the chance of a lucky find for each thousand tokens eaten: one about every 200k tokens
LEGENDARY, RARE = 0.01, 0.12  # of those finds, one in a hundred is legendary (about once in 20M tokens) and one in eight is rare
SHINY_ODDS = 1 / 50
STREAK_FOR_FLAME = 7
SPECIES = {"blob", "cat", "bunny", "duck", "cactus", "ghost", "robot", "mushroom", "axolotl", "dragon",
           "goose", "octopus", "owl", "penguin", "turtle", "snail", "capybara", "chonk"}

HEAD_START = 250_000          # the most a pet may bring with it when it joins
BELLY = 1_000_000             # the most a pet can eat in one day; it empties at this pace too
EPOCH = 10 ** 10              # room for a join time (in seconds) beside the score, to break ties
WAIT = 60                     # seconds a pet must leave between two reports
TOP = 100
FRESH = 30                    # seconds the board is remembered before it is read again
JOINS = int(os.environ.get("JOINS_PER_NETWORK", "20"))      # new pets one network may hatch in a day

ID = re.compile(r"^[a-f0-9]{32}$")
KEY = re.compile(r"^[a-f0-9]{32,64}$")
NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ]{0,11}$")
TEAM = re.compile(r"^[a-z0-9]{1,12}-[a-z0-9]{8}$")


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

    def top(self, count, team=None):
        index, value = ("team", team) if team else ("board", "all")
        found = self.table.query(IndexName=index, KeyConditionExpression=self.Key(index).eq(value),
                                 ScanIndexForward=False, Limit=count)
        return found["Items"]

    def count(self, what, limit, expires):
        """Adds one to a counter and says whether it is still within `limit`. The row cleans itself up at `expires`."""
        from botocore.exceptions import ClientError
        try:
            self.table.update_item(Key={"id": what}, UpdateExpression="ADD seen :one SET expires = :expires",
                                   ConditionExpression="attribute_not_exists(seen) OR seen < :limit",
                                   ExpressionAttributeValues={":one": 1, ":limit": limit, ":expires": expires})
            return True
        except ClientError as error:
            if error.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise


store = None                  # made on first use; the tests put their own here
luck = random.SystemRandom()  # the board's dice; the tests put their own here
remembered = {"at": 0.0, "rows": []}
teams = {}                    # team code -> the same, for each team somebody looked at lately


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
    return {"rank": rank, "name": row["name"], "species": row.get("species", "blob"), "score": score, "stage": stage_of(score), "shiny": bool(row.get("shiny")),
            "wearing": row.get("wearing"), "streak": int(row.get("streak", 0)), "days": int(row.get("days", 0)), "joined": int(row["joined"])}


def board(now):
    if now - remembered["at"] > FRESH:
        rows = [row for row in store.top(TOP + 20) if not row.get("hidden")][:TOP]
        remembered.update(at=now, rows=[shown(row, i + 1) for i, row in enumerate(rows)])
    return remembered["rows"]


def team_board(code, now, anew=False):
    kept = teams.get(code)
    if anew or kept is None or now - kept["at"] > FRESH:
        if len(teams) > 500:
            teams.clear()
        rows = [row for row in store.top(TOP + 20, team=code) if not row.get("hidden")][:TOP]
        kept = teams[code] = {"at": now, "rows": [shown(row, i + 1) for i, row in enumerate(rows)]}
    return kept["rows"]


def rank_of(row, rows):
    """A pet's place among `rows` if it is in the top, else None. Counting every pet above it would cost more the bigger the board got."""
    mine = (int(row["score"]), -int(row["joined"]))
    ahead = sum(1 for other in rows if (other["score"], -other["joined"]) > mine)
    return ahead + 1 if ahead < TOP else None


def network(address):
    """A name for where a request came from that is not the address itself. A whole IPv6 home counts as one."""
    try:
        ip = ipaddress.ip_address(address)
        if ip.version == 6:
            ip = ipaddress.ip_network(f"{ip}/64", strict=False).network_address
    except ValueError:
        ip = "unknown"
    return hashlib.sha256(f"{os.environ.get('PEPPER', '')}|{ip}".encode()).hexdigest()[:24]


def lucky(row, eaten):
    """Rolls the board's dice for what a pet just ate. Returns what it found this time."""
    rolls, crumbs = divmod(int(row.get("crumbs", 0)) + eaten, 1000)
    have, new = list(row.get("found", [])), []
    for _ in range(rolls):
        if luck.random() < FIND_ODDS:
            roll = luck.random()
            left = [item for item in FINDS["legendary" if roll < LEGENDARY else "rare" if roll < LEGENDARY + RARE else "common"] if item not in have]
            if left:
                new.append(luck.choice(left))
                have.append(new[-1])
    row.update(crumbs=crumbs, found=have)
    return new


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
    team = body.get("team") or None
    if team is not None and not (isinstance(team, str) and TEAM.match(team)):
        raise Refused(400, "that is not a team code")
    is_public = body.get("public") is not False
    if not is_public and team is None:
        raise Refused(400, "join the board or a team")
    items = body.get("items") if isinstance(body.get("items"), list) else []
    deeds = sorted({item for item in items if isinstance(item, str) and item in DEEDS})
    species = body.get("species") if body.get("species") in SPECIES else "blob"
    wearing = body.get("wearing") if isinstance(body.get("wearing"), str) else None
    return {"id": pet_id, "key": key, "name": name.strip(), "species": species, "lifetime": int(lifetime), "deeds": deeds, "wearing": wearing,
            "public": is_public, "team": team}


def report(body, now, address=""):
    seen = checked(body)
    now = int(now)
    today = now // 86_400
    row = store.get(seen["id"])
    if row is None:
        if not store.count(f"net#{network(address)}#{today}", JOINS, now + 2 * 86_400):
            raise Refused(429, "this network has hatched enough pets for today; try tomorrow")
        eaten = min(seen["lifetime"], HEAD_START)
        row = {"id": seen["id"], "lock": lock(seen["key"]), "joined": now, "score": eaten, "belly": BELLY - eaten,
               "counted": seen["lifetime"], "days": 0, "streak": 0, "best": 0, "fed": -1, "crumbs": 0, "found": [],
               "shiny": luck.random() < SHINY_ODDS}
        was, left_over, new = None, seen["lifetime"] > eaten, []       # what it ate before it joined rolls no dice
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
        new = lucky(row, eaten)
    if eaten > 0 and int(row["fed"]) != today:          # days and streaks run on the board's clock, not the pet's word
        streak = int(row["streak"]) + 1 if int(row["fed"]) == today - 1 else 1
        row.update(days=int(row["days"]) + 1, streak=streak, best=max(streak, int(row.get("best", 0))), fed=today)
    score = int(row["score"])
    items = set(seen["deeds"]) | set(row.get("found", [])) | {item for item, at in MILESTONES.items() if score >= at}
    if int(row.get("best", 0)) >= STREAK_FOR_FLAME:
        items.add("flame")
    row.update(name=seen["name"], species=seen["species"], items=sorted(items), wearing=seen["wearing"] if seen["wearing"] in items else None,
               updated=now, place=place(score, int(row["joined"])))
    for mark, value in (("board", "all" if seen["public"] else None), ("team", seen["team"])):      # only a row that carries the mark is listed there
        if value is None:
            row.pop(mark, None)
        else:
            row[mark] = value
    store.put(row, was)
    if was is None:
        remembered["at"] = 0.0      # a new pet: read the board again so it shows up at once
    out = {"score": score, "stage": stage_of(score), "rank": rank_of(row, board(now)) if seen["public"] else None, "streak": int(row["streak"]),
           "days": int(row["days"]), "full": left_over, "shiny": bool(row["shiny"]), "items": row["items"], "found": new}
    if seen["team"]:
        out["teamRank"] = rank_of(row, team_board(seen["team"], now, anew=True))
    return out


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
            asked = event.get("queryStringParameters") or {}
            code, pet_id = asked.get("team", ""), asked.get("id", "")
            if code and not TEAM.match(code):
                raise Refused(400, "that is not a team code")
            rows = team_board(code, now) if code else board(now)
            out = {"pets": rows, "rules": {"headStart": HEAD_START, "perDay": BELLY}}
            if code:
                out["team"] = code.rsplit("-", 1)[0]
            row = store.get(pet_id) if ID.match(pet_id) else None
            if row is not None and (row.get("team") == code if code else row.get("board") == "all"):
                out["you"] = shown(row, rank_of(row, rows))
            return answer(200, out) if code or "you" in out else answer(200, out, cache=FRESH)
        if path == "/pets" and method in ("POST", "DELETE"):
            raw = event.get("body") or ""
            if len(raw) > 4096:
                raise Refused(413, "too big")
            try:
                body = json.loads(raw)
            except ValueError:
                raise Refused(400, "send JSON") from None
            if method == "DELETE":
                return answer(200, leave(body))
            return answer(200, report(body, now, event["requestContext"]["http"].get("sourceIp", "")))
        raise Refused(404, "nothing here")
    except Refused as no:
        return answer(no.status, {"error": no.why})
