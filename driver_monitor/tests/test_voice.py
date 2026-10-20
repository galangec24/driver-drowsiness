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
