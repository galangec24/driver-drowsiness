"""Fuzzy-logic fatigue assessment (Mamdani inference) over the camera's drowsiness signs.

Single signs are often harmless (people blink a lot while talking, yawn once when bored), but
*combinations* are telling: frequent blinking plus repeated yawning, slow blinks plus eyes closing
more often. Fuzzy rules express exactly that, with smooth degrees instead of hard cut-offs.

Inputs (None = not measured yet; conditions on it are left out of the rule):
  perclos       share of the last 30 s with eyes closed (0..1), sets relative to the driver's
                own PERCLOS limit (adaptive, from the server)
  closure_s     how long the eyes are closed right now
  blink_rate    blinks per minute, averaged over 3 min     (detectors/blink.py)
  long_blinks   slow blinks (0.5-2 s) in the last 2 min    (detectors/blink.py)
  yawns         yawns in the last 10 min, fading 2 min after the latest (detectors/mouth.py)
  nods          head nods, recency-weighted                (detectors/head_nod.py)

Real-world reading (single events are normal, only repeated signs over a realistic span count):
  1 yawn = nothing · 2 yawns in 10 min = a sign · 3+ in 10 min = fatigue
  blinking 25+/min for 3 minutes = unusual · 3+ slow blinks in 2 min = a sign, 6+ = fatigue
  eyes closed ≥ 2 s = microsleep · 2 nods = falling asleep

Output: fatigue 0..1 (centroid), banded like the server: > 0.7 drowsy, > 0.4 warning.
Rule strength: AND = min, NOT = 1 - μ; aggregation = max; defuzzification = centroid.
The "awake" rule is an *otherwise* rule: its strength is also capped by 1 - (strongest worrying
rule), so a clear warning sign isn't averaged away by the many signs that are still normal.
"""

from __future__ import annotations

from dataclasses import dataclass, field

DROWSY_BAND = 0.7
WARNING_BAND = 0.4

Trap = tuple[float, float, float, float]


def trap(x: float, p: Trap) -> float:
    """Trapezoid membership: 0 below a, rises to 1 at b, 1 until c, falls to 0 at d."""
    a, b, c, d = p
    if x < a or x > d:
        return 0.0
    if b <= x <= c:
        return 1.0
    if x < b:
        return (x - a) / (b - a) if b > a else 1.0
    return (d - x) / (d - c) if d > c else 1.0


# Output sets over fatigue 0..1
OUTPUT: dict[str, Trap] = {
    "low": (0.0, 0.0, 0.2, 0.4),
    "medium": (0.3, 0.5, 0.5, 0.7),
    "high": (0.6, 0.8, 1.0, 1.0),
}
_XS = [i / 100 for i in range(101)]


@dataclass(frozen=True)
class Cond:
    var: str
    term: str
    negate: bool = False


@dataclass(frozen=True)
class Rule:
    conds: tuple[Cond, ...]
    out: str
    label: str


def _c(spec: str) -> Cond:
    """'yawns is many' / 'yawns not many' → Cond."""
    var, op, term = spec.split()
    return Cond(var, term, op == "not")


def rule(out: str, label: str, *conds: str) -> Rule:
    return Rule(tuple(_c(s) for s in conds), out, label)


RULES: tuple[Rule, ...] = (
    # Strong signs on their own
    rule("high", "eyes closed much of the time", "perclos is high"),
    rule("high", "eyes closed too long (microsleep)", "closure_s is long"),
    rule("high", "repeated head nods", "nods is many"),
    # Combinations
    rule("high", "slow blinks and repeated yawning", "long_blinks is many", "yawns is some"),
    rule("high", "slow blinks, eyes closing more", "long_blinks is many", "perclos is medium"),
    rule("high", "repeated yawning, eyes closing more", "yawns is many", "perclos is medium"),
    rule("high", "unusual blinking and repeated yawning", "blink_rate is high", "yawns is many"),
    rule("medium", "many slow blinks (6+ in 2 min)", "long_blinks is many"),
    rule("medium", "repeated yawning (3+ in 10 min)", "yawns is many"),
    rule("medium", "eyes closing more often", "perclos is medium"),
    rule("medium", "head nod", "nods is some"),
    rule("medium", "unusual, slow blinking", "blink_rate is high", "long_blinks is some"),
    rule("medium", "unusual blinking and yawning", "blink_rate is high", "yawns is some"),
    rule("medium", "slow blinks and yawning", "long_blinks is some", "yawns is some"),
    # Everything calm
    rule(
        "low",
        "awake",
        "perclos is low",
        "closure_s is short",
        "nods is none",
        "yawns not many",
        "long_blinks not many",
    ),
)


def input_sets(
    perclos_limit: float = 0.4, drowsy_s: float = 2.0, yawn_limit: int = 3
) -> dict[str, dict[str, Trap]]:
    """Membership functions, scaled to the driver's own (server-tuned) limits."""
    L, D, Y = perclos_limit, drowsy_s, float(yawn_limit)
    big = 1e9
    return {
        "perclos": {
            "low": (0, 0, 0.5 * L, 0.75 * L),
            "medium": (0.5 * L, 0.75 * L, 0.75 * L, L),
            "high": (0.75 * L, L, big, big),
        },
        "closure_s": {"short": (0, 0, 0.3 * D, 0.6 * D), "long": (0.4 * D, D, big, big)},
        "blink_rate": {"normal": (0, 0, 20, 28), "high": (20, 28, big, big)},
        # per 2 minutes: 1-2 slow blinks are normal, 3-4 a sign, 6+ fatigue
        "long_blinks": {"few": (0, 0, 1, 3), "some": (2, 3, 4, 6), "many": (4, 6, big, big)},
        # per 10 minutes: one yawn is nothing, two a sign, Y (3) or more fatigue
        "yawns": {"none": (0, 0, 1, 2), "some": (1, 2, Y - 1, Y), "many": (Y - 1, Y, big, big)},
        "nods": {"none": (0, 0, 0, 1), "some": (0, 1, 1, 2), "many": (1, 2, big, big)},
    }


CATEGORY = {0: "Alert", 1: "Fatigue signs", 2: "Drowsy"}
ADVICE = {0: "", 1: "consider a break soon", 2: "stop and rest now"}


@dataclass
class FuzzyResult:
    score: float  # fatigue 0..1
    fired: list[tuple[str, str, float]] = field(default_factory=list)  # (label, out, strength)

    @property
    def level(self) -> int:
        """0 awake, 1 warning, 2 drowsy (same bands as the server)."""
        return 2 if self.score > DROWSY_BAND else 1 if self.score > WARNING_BAND else 0

    @property
    def category(self) -> str:
        """Alert / Fatigue signs / Drowsy (what the family and the driver are told)."""
        return CATEGORY[self.level]

    @property
    def reason(self) -> str:
        """Strongest non-calm rule, e.g. 'frequent blinking and repeated yawning'."""
        worrying = [f for f in self.fired if f[1] != "low"]
        if not worrying:
            return ""
        rank = {"high": 2, "medium": 1}
        return max(worrying, key=lambda f: (round(f[2], 2), rank[f[1]]))[0]


class FatigueFuzzy:
    def __init__(self, perclos_limit: float = 0.4, drowsy_s: float = 2.0, yawn_limit: int = 3) -> None:
        self.set_limits(perclos_limit, drowsy_s, yawn_limit)

    def set_limits(self, perclos_limit: float, drowsy_s: float, yawn_limit: int = 3) -> None:
        self.sets = input_sets(perclos_limit, max(0.5, drowsy_s), max(2, int(yawn_limit)))

    def _mu(self, c: Cond, inputs: dict[str, float | None]) -> float | None:
        x = inputs.get(c.var)
        if x is None:
            return None
        m = trap(float(x), self.sets[c.var][c.term])
        return 1.0 - m if c.negate else m

    def evaluate(self, **inputs: float | None) -> FuzzyResult:
        clipped: dict[str, float] = {}
        fired = []
        worry = 0.0
        # Worrying rules first, then the "awake" (otherwise) rule.
        for r in sorted(RULES, key=lambda r: r.out == "low"):
            mus = [m for m in (self._mu(c, inputs) for c in r.conds) if m is not None]
            if not mus:
                continue  # nothing this rule needs has been measured yet
            strength = min(mus)
            if r.out == "low":
                strength = min(strength, 1.0 - worry)
            else:
                worry = max(worry, strength)
            if strength > 0:
                fired.append((r.label, r.out, strength))
                clipped[r.out] = max(clipped.get(r.out, 0.0), strength)
        if not clipped:
            return FuzzyResult(0.0, fired)
        num = den = 0.0
        for x in _XS:
            mu = max(min(s, trap(x, OUTPUT[o])) for o, s in clipped.items())
            num += mu * x
            den += mu
        return FuzzyResult(round(num / den, 3) if den else 0.0, fired)
