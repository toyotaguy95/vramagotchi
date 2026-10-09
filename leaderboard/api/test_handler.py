"""Run from the repository root:  python3 -m unittest discover leaderboard/api"""
import json
import unittest

import handler

A, B, C = "a" * 32, "b" * 32, "c" * 32
KEY = "1" * 32
DAY = 86_400


class Memory:
    def __init__(self):
        self.rows = {}

    def get(self, pet_id):
        return dict(self.rows[pet_id]) if pet_id in self.rows else None

    def put(self, row, was=None):
        old = self.rows.get(row["id"])
        if (was is None and old is not None) or (was is not None and (old is None or old["updated"] != was)):
            raise handler.Refused(409, "try again")
        self.rows[row["id"]] = dict(row)

    def delete(self, pet_id):
        self.rows.pop(pet_id, None)

    def top(self, count, team=None):
        listed = [row for row in self.rows.values() if (row.get("team") == team if team else row.get("board") == "all")]
        return sorted(listed, key=lambda row: -row["place"])[:count]

    def count(self, what, limit, expires):
        self.counts[what] = self.counts.get(what, 0) + 1
        return self.counts[what] <= limit

    counts = {}


class Dice:
    """Dice that land the way a test says: `rolls` are handed out in order, then nothing lucky ever happens."""

    def __init__(self, *rolls):
        self.rolls = list(rolls)

    def random(self):
        return self.rolls.pop(0) if self.rolls else 0.99

    def choice(self, things):
        return things[0]


def call(method, path, body=None, now=1_000_000, query=None, address="203.0.113.7"):
    event = {"requestContext": {"http": {"method": method, "sourceIp": address}}, "rawPath": path, "queryStringParameters": query,
             "body": json.dumps(body) if body is not None else None}
    if method == "GET":
        handler.teams.clear()
        handler.remembered.update(at=0.0)      # the tests read the board as it is now, not as it was remembered
    out = handler.handle(event, now=now)
    return out["statusCode"], json.loads(out["body"])


def pet(pet_id=A, lifetime=0, **more):
    return dict({"id": pet_id, "key": KEY, "name": "Mochi", "lifetime": lifetime}, **more)


class Board(unittest.TestCase):
    def setUp(self):
        handler.store = Memory()
        handler.store.counts = {}
        handler.luck = Dice()
        handler.remembered.update(at=0.0, rows=[])
        handler.teams.clear()

    def test_a_pet_joins_with_at_most_the_head_start(self):
        status, out = call("POST", "/pets", pet(lifetime=9_000_000_000))
        self.assertEqual((status, out["score"], out["full"]), (200, handler.HEAD_START, True))
        self.assertEqual(call("POST", "/pets", pet(B, lifetime=1_200))[1]["score"], 1_200)

    def test_it_grows_only_by_what_it_ate_and_never_shrinks(self):
        call("POST", "/pets", pet(lifetime=1_000))
        self.assertEqual(call("POST", "/pets", pet(lifetime=51_000), now=1_000_100)[1]["score"], 51_000)
        self.assertEqual(call("POST", "/pets", pet(lifetime=10), now=1_000_200)[1]["score"], 51_000)
        self.assertEqual(call("POST", "/pets", pet(lifetime=51_500), now=1_000_300)[1]["score"], 51_500)

    def test_a_pet_cannot_eat_more_than_a_belly_a_day(self):
        call("POST", "/pets", pet(lifetime=0))
        status, out = call("POST", "/pets", pet(lifetime=10 ** 12), now=1_000_100)
        self.assertEqual((out["score"], out["full"]), (handler.BELLY, True))
        out = call("POST", "/pets", pet(lifetime=10 ** 13), now=1_000_100 + DAY // 2)[1]
        self.assertEqual(out["score"], handler.BELLY + handler.BELLY // 2)
        out = call("POST", "/pets", pet(lifetime=10 ** 14), now=1_000_100 + DAY // 2 + 30 * DAY)[1]
        self.assertEqual(out["score"], handler.BELLY * 2 + handler.BELLY // 2)     # a month away fills one belly, not thirty

    def test_days_and_streaks_are_counted_by_the_board(self):
        start = 20_000 * DAY + 100
        self.assertEqual(call("POST", "/pets", pet(lifetime=10), now=start)[1]["streak"], 1)
        self.assertEqual(call("POST", "/pets", pet(lifetime=20), now=start + 3_600)[1]["streak"], 1)       # same day
        self.assertEqual(call("POST", "/pets", pet(lifetime=20), now=start + DAY)[1]["streak"], 1)        # reported, ate nothing
        out = call("POST", "/pets", pet(lifetime=30), now=start + DAY + 3_600)[1]
        self.assertEqual((out["streak"], out["days"]), (2, 2))
        out = call("POST", "/pets", pet(lifetime=40), now=start + 4 * DAY)[1]
        self.assertEqual((out["streak"], out["days"]), (1, 3))                                             # missed days break it

    def test_between_equal_scores_the_earlier_pet_is_ahead(self):
        call("POST", "/pets", pet(B, lifetime=500, name="Late"), now=2_000_000)
        call("POST", "/pets", pet(A, lifetime=500, name="Early"), now=1_000_000)
        handler.remembered.update(at=0.0)
        self.assertEqual([p["name"] for p in call("GET", "/board", now=2_000_100)[1]["pets"]], ["Early", "Late"])
        self.assertEqual(call("GET", "/board", now=2_000_100, query={"id": B})[1]["you"]["rank"], 2)

    def test_only_the_owner_can_report_or_remove_a_pet(self):
        call("POST", "/pets", pet(lifetime=5))
        self.assertEqual(call("POST", "/pets", dict(pet(lifetime=99_999), key="2" * 32), now=1_000_100)[0], 403)
        self.assertEqual(call("DELETE", "/pets", {"id": A, "key": "2" * 32})[0], 403)
        self.assertEqual(call("DELETE", "/pets", {"id": A, "key": KEY})[0], 200)
        self.assertEqual(call("GET", "/board")[1]["pets"], [])

    def test_reports_come_no_faster_than_one_a_minute(self):
        call("POST", "/pets", pet())
        self.assertEqual(call("POST", "/pets", pet(lifetime=50), now=1_000_010)[0], 429)

    def test_bad_reports_are_refused(self):
        for bad in (pet(name=""), pet(name="<script>"), pet(name="x" * 13), pet(lifetime=-1), pet(lifetime="9"), pet(lifetime=True),
                    dict(pet(), id="nope"), dict(pet(), key="short"), []):
            self.assertEqual(call("POST", "/pets", bad)[0], 400, bad)
        self.assertEqual(call("GET", "/nothing")[0], 404)

    def test_the_board_is_sorted_and_shows_nothing_private(self):
        call("POST", "/pets", pet(A, lifetime=100, items=["crown", "flower", "star", "bandage", "made-up"], wearing="crown", shiny=True, streak=999))
        call("POST", "/pets", pet(B, lifetime=20_000, name="Tofu", species="duck", items=["headphones"], wearing="headphones"))
        call("POST", "/pets", pet(C, lifetime=7, name="Bean"))
        handler.store.rows[C]["hidden"] = True
        status, out = call("GET", "/board", query={"id": A})
        self.assertEqual([(p["rank"], p["name"], p["stage"], p["wearing"]) for p in out["pets"]],
                         [(1, "Tofu", "baby", "headphones"), (2, "Mochi", "baby", None)])     # an unearned crown is not shown
        self.assertEqual((out["you"]["rank"], out["you"]["shiny"], out["you"]["streak"]), (2, False, 1))    # a claimed shiny or streak is ignored
        self.assertEqual(handler.store.rows[A]["items"], ["bandage"])                                         # claimed finds and hats are not kept
        self.assertEqual([p["species"] for p in out["pets"]], ["duck", "blob"])
        call("POST", "/pets", pet("d" * 32, name="Odd", species="<unicorn>"))
        self.assertEqual(handler.store.rows["d" * 32]["species"], "blob")                                     # an animal that does not exist
        self.assertFalse({"id", "key", "lock", "counted", "belly", "team", "found"} & set(out["pets"][0]))

    def test_the_board_rolls_the_luck(self):
        handler.luck = Dice(0.001)                                                  # the roll at hatching: shiny
        out = call("POST", "/pets", pet(lifetime=200_000))[1]
        self.assertEqual((out["shiny"], out["items"], out["found"]), (True, ["headphones", "wizard"], []))     # hats for what it ate; no dice for the head start
        handler.luck = Dice(0.5, 0.01, 0.01, 0.5, 0.01, 0.9)                        # 3,500 tokens: three rolls, the second finds the star
        out = call("POST", "/pets", pet(lifetime=203_500), now=1_000_100)[1]
        self.assertEqual((out["found"], out["items"]), (["star"], ["headphones", "star", "wizard"]))
        handler.luck = Dice(0.01, 0.9)                                              # 500 more make up the next thousand with the 500 left over
        out = call("POST", "/pets", pet(lifetime=204_000, wearing="star"), now=1_000_200)[1]
        self.assertEqual(out["found"], ["flower"])
        self.assertEqual(call("GET", "/board", query={"id": A})[1]["you"]["wearing"], "star")
        handler.luck = Dice(*[0.01, 0.9] * 50)                                      # tokens the belly turns away roll nothing
        out = call("POST", "/pets", pet(lifetime=10 ** 12), now=1_000_300)[1]
        self.assertEqual((out["found"], handler.luck.rolls), (["sprout"], []))      # it found the one common thing left, once

    def test_a_week_in_a_row_earns_the_flame_and_keeps_it(self):
        start = 20_000 * DAY + 100
        for day in range(7):
            out = call("POST", "/pets", pet(lifetime=10 * (day + 1)), now=start + day * DAY)[1]
        self.assertEqual((out["streak"], out["items"]), (7, ["flame"]))
        out = call("POST", "/pets", pet(lifetime=500), now=start + 20 * DAY)[1]
        self.assertEqual((out["streak"], out["items"]), (1, ["flame"]))

    def test_one_network_can_only_hatch_so_many_pets_a_day(self):
        ids = [f"{n:032x}" for n in range(handler.JOINS + 1)]
        for pet_id in ids[:-1]:
            self.assertEqual(call("POST", "/pets", pet(pet_id))[0], 200)
        self.assertEqual(call("POST", "/pets", pet(ids[-1]))[0], 429)
        self.assertEqual(call("POST", "/pets", pet(ids[-1]), address="198.51.100.9")[0], 200)       # somewhere else is fine
        self.assertEqual(call("POST", "/pets", pet("f" * 32), now=1_000_000 + DAY)[0], 200)          # and so is tomorrow
        self.assertEqual(call("POST", "/pets", pet(ids[0], lifetime=5), now=1_000_100)[0], 200)      # a pet already here still reports
        self.assertEqual(handler.network("2001:db8:1:2:aaaa::1"), handler.network("2001:db8:1:2:bbbb::2"))
        self.assertNotEqual(handler.network("2001:db8:1:2::1"), handler.network("2001:db8:1:3::1"))
        self.assertNotIn("203.0.113.7", "".join(handler.store.counts))

    def test_a_team_has_its_own_board(self):
        acme, other = "acme-k3x9q2ab", "globex-zzzzzzzz"
        self.assertEqual(call("POST", "/pets", pet(A, lifetime=300, name="Ana", team=acme))[1]["teamRank"], 1)
        out = call("POST", "/pets", pet(B, lifetime=900, name="Bo", team=acme, public=False))[1]
        self.assertEqual((out["teamRank"], out["rank"]), (1, None))
        call("POST", "/pets", pet(C, lifetime=5_000, name="Cy", team=other))
        status, out = call("GET", "/board", query={"team": acme, "id": A})
        self.assertEqual((out["team"], [p["name"] for p in out["pets"]], out["you"]["rank"]), ("acme", ["Bo", "Ana"], 2))
        self.assertEqual([p["name"] for p in call("GET", "/board")[1]["pets"]], ["Cy", "Ana"])       # Bo is on its team only
        self.assertNotIn("you", call("GET", "/board", query={"id": B})[1])
        call("POST", "/pets", pet(A, lifetime=300, name="Ana"), now=1_000_100)                          # Ana leaves the team
        self.assertEqual([p["name"] for p in call("GET", "/board", query={"team": acme}, now=1_000_200)[1]["pets"]], ["Bo"])
        self.assertEqual(call("GET", "/board", query={"team": "Not A Code"})[0], 400)
        self.assertEqual(call("POST", "/pets", pet("d" * 32, team="nope"))[0], 400)
        self.assertEqual(call("POST", "/pets", pet("d" * 32, public=False))[0], 400)                   # neither the board nor a team


if __name__ == "__main__":
    unittest.main()
