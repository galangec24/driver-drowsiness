"""Spoken guidance: the right sentence, at the right time, never chattering."""

from ui.voice import HIGH, MILD, NONE, VoiceGuide, _clean, make_speaker, message_for


def guide(**kw):
    said: list[str] = []
    return VoiceGuide(speak=said.append, **kw), said


def test_messages_match_the_reason() -> None:
    assert "pull over" in message_for(HIGH, "eyes closed 2.4s")
    assert "nodding off" in message_for(HIGH, "head nod")
    assert "eyes on the road" in message_for(HIGH, "eyes off the road 5s").lower()
    assert "keep your eyes on the road" in message_for(MILD, "eyes off the road")
    assert "focus" in message_for(MILD, "restless: too much movement")
    assert "yawning" in message_for(MILD, "fatigue: repeated yawning (3+ in 10 min)")
    assert "break" in message_for(MILD, "fatigue: unusual blinking and yawning")
    assert message_for(NONE, "") == ""


def test_escalation_speaks_at_once_and_recovery_thanks_the_driver() -> None:
    g, said = guide()
    g.on_alert(MILD, "fatigue: repeated yawning", 0.0)
    g.on_alert(HIGH, "eyes closed 2.1s", 1.0)  # more serious: no waiting
    g.on_alert(NONE, "", 20.0)
    assert len(said) == 3
    assert "yawning" in said[0] and "pull over" in said[1] and said[2].startswith("Thank you")


def test_no_chattering() -> None:
    g, said = guide()
    g.on_alert(MILD, "eyes off the road", 0.0)
    g.on_alert(NONE, "", 2.0)  # back within the 8 s gap: stay quiet
    g.on_alert(MILD, "eyes off the road", 10.0)  # same sentence within 30 s: not repeated
    assert len(said) == 1
    g.on_alert(NONE, "", 25.0)
    g.on_alert(MILD, "eyes off the road", 45.0)
    assert said.count("Please keep your eyes on the road.") == 2


def test_greeting_once_per_driver_and_break_reminder() -> None:
    g, said = guide(break_every_s=7200)
    g.greet("Galang", 0.0)
    g.greet("Galang", 5.0)
    assert said == ["Hello Galang. Drive safely, I am watching for signs of fatigue."]
    g.tick(0.0, driving=True)
    g.tick(3600.0, driving=True)
    assert len(said) == 1
    g.tick(7200.0, driving=True)
    assert "2 hours" in said[-1] and "fifteen minute break" in said[-1]
    g.tick(7300.0, driving=True)
    assert len(said) == 2  # not again until another 2 h


def test_text_is_sanitised_and_off_engine_is_silent() -> None:
    assert _clean("Hello'); Remove-Item C:\\ -Recurse; ('") == "Hello Remove-Item C -Recurse"
    assert _clean("Ana's car $(whoami) `id`") == "Anas car whoami id"
    off = make_speaker("off")
    off("anything")  # no engine, no error


def test_one_blink_after_recovery_does_not_restart_the_fatigue_voice() -> None:
    """Reported bug: after a fatigue test and "Thank you", a single blink said "fatigue" again."""
    g, said = guide()
    g.on_alert(MILD, "fatigue: many slow blinks (6+ in 2 min)", 0.0)
    g.on_alert(NONE, "", 20.0)  # awake again: "Thank you"
    g.on_alert(MILD, "fatigue: slow blinks and yawning", 35.0)  # a blink nudges the score back up
    assert said[-1].startswith("Thank you") and len(said) == 2
    g.on_alert(NONE, "", 40.0)
    g.on_alert(MILD, "eyes off the road", 50.0)  # but a real new problem still speaks
    assert said[-1] == "Please keep your eyes on the road."
    g.on_alert(HIGH, "eyes closed 2.2s", 55.0)  # and a drowsy alarm always does
    assert "pull over" in said[-1]


def test_eyes_still_closed_repeats_wake_up_every_3_s_until_they_open() -> None:
    """Field test 2026-11-03: a 15 s eye closure got one sentence, then silence until the eyes
    opened. The car must keep calling while the eyes stay shut."""
    from fusion.watch_alerts import WatchAlerter

    g, said = guide()
    beeps: list[float] = []
    now = {"t": 0.0}
    alerter = WatchAlerter(send=lambda lv: None)

    def send(level: int) -> None:
        beeps.append(now["t"])
        g.on_alert(level, alerter.reason_now, now["t"])

    alerter.send = send
    t = 0.0
    while t < 15.0:  # eyes shut from t=0; microsleep limit 2 s
        now["t"] = t
        alerter.on_frame(closed_for_s=t, perclos=0.0, now=t)
        t += 0.1
    assert said[0] == "Your eyes have been closing. Please pull over safely and rest."
    wake = [s for s in said if s == "Wake up! Open your eyes!"]
    assert 3 <= len(wake) <= 5  # every ~3 s after the first sentence (2 s .. 15 s)
    assert len(beeps) >= 4  # each repeat also beeps / vibrates
    gaps = [b - a for a, b in zip(beeps, beeps[1:], strict=False)]
    assert all(2.9 <= g_ <= 3.2 for g_ in gaps)
    for _ in range(40):  # eyes open: the calls stop, then "thank you"
        now["t"] = t
        alerter.on_frame(closed_for_s=0.0, perclos=0.1, now=t)
        t += 0.1
    assert said[-1].startswith("Thank you")
    assert len([s for s in said if s == "Wake up! Open your eyes!"]) == len(wake)


def test_other_alarms_keep_the_calm_15_s_rhythm() -> None:
    from fusion.watch_alerts import WatchAlerter

    sent: list[float] = []
    alerter = WatchAlerter(send=lambda lv: sent.append(lv))
    t = 0.0
    while t < 20.0:  # looking away for a long time: HIGH "eyes off the road", eyes open
        alerter.on_frame(closed_for_s=0.0, perclos=0.0, now=t, away_for_s=5.0 + t)
        t += 0.1
    assert len(sent) == 2  # at once, then once after 15 s
