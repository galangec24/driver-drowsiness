"""Automatic driver recognition: when to ask the backend, and what to do with its answer."""

from transport.driver_identity import DriverIdentity


def test_fixed_driver_id_never_identifies():
    ident = DriverIdentity(fixed_id="abc123abc123abc123abc123")
    assert ident.driver_id == "abc123abc123abc123abc123"
    assert not ident.should_identify(True, 0.0)
    assert not ident.on_face(False, 100.0)
    assert "DRIVER_ID" in ident.label()


def test_identifies_when_a_face_appears_and_retries_until_matched():
    ident = DriverIdentity()
    assert not ident.should_identify(False, 0.0)  # empty seat: nothing to send
    assert ident.should_identify(True, 0.0)
    ident.started()
    assert not ident.should_identify(True, 0.5)  # one request at a time

    assert not ident.on_result({"driverId": None, "reason": "unknown"}, 1.0)
    assert ident.label().startswith("Unknown face")
    assert not ident.should_identify(True, 2.0)  # waits retry_s
    assert ident.should_identify(True, 5.1)

    ident.started()
    assert ident.on_result({"driverId": "d1", "name": "Ana", "confidence": 0.82}, 6.0)
    assert ident.driver_id == "d1"
    assert ident.label() == "Driver: Ana (82%)"
    assert not ident.should_identify(True, 60.0)  # next check only after recheck_s


def test_ambiguous_lookalikes_are_not_guessed():
    ident = DriverIdentity()
    ident.started()
    ident.on_result({"driverId": None, "reason": "ambiguous", "candidates": ["Ana", "Bea"]}, 0.0)
    assert ident.driver_id == ""
    assert ident.label() == "Not sure: Ana / Bea"


def test_empty_seat_clears_the_driver_so_the_next_person_is_identified():
    ident = DriverIdentity(absent_reset_s=20.0)
    ident.started()
    ident.on_result({"driverId": "d1", "name": "Ana", "confidence": 0.9}, 0.0)
    assert not ident.on_face(False, 10.0)
    assert not ident.on_face(False, 25.0)  # 15 s gone: maybe just looking away
    assert not ident.on_face(True, 26.0)  # back: still Ana
    assert ident.driver_id == "d1"

    ident.on_face(False, 30.0)
    assert ident.on_face(False, 51.0)  # gone 21 s: driver change possible
    assert ident.driver_id == ""
    assert ident.should_identify(True, 52.0)


def test_routine_recheck_keeps_the_driver_unless_someone_else_is_recognised():
    ident = DriverIdentity(recheck_s=300.0)
    ident.started()
    ident.on_result({"driverId": "d1", "name": "Ana", "confidence": 0.9}, 0.0)
    assert ident.should_identify(True, 301.0)
    ident.started()
    assert not ident.on_result({"driverId": None, "reason": "no_face"}, 301.0)
    assert ident.driver_id == "d1"
    ident.started()
    assert ident.on_result({"driverId": "d2", "name": "Ben", "confidence": 0.8}, 400.0)
    assert ident.name == "Ben"


def test_errors_back_off_and_are_shown():
    ident = DriverIdentity(error_retry_s=10.0)
    ident.started()
    ident.on_error("No Guardian Drive account uses that FAMILY_EMAIL", 0.0)
    assert ident.label().startswith("Identify failed: No Guardian Drive account")
    assert not ident.should_identify(True, 5.0)
    assert ident.should_identify(True, 10.0)


def test_passengers_are_shown_but_not_monitored():
    ident = DriverIdentity()
    ident.started()
    ident.on_result(
        {
            "driverId": "d1",
            "name": "Ana",
            "confidence": 0.9,
            "passengers": [{"driverId": "d2", "name": "Ben"}],
        },
        0.0,
    )
    assert ident.driver_id == "d1"
    assert ident.label() == "Driver: Ana (90%)  + passenger Ben"


# Driver out of the car (gas station, takeout) and someone unknown at the wheel (2026-11-03).

GALANG = {"driverId": "a" * 24, "name": "Galang", "confidence": 0.7}
UNKNOWN = {"driverId": None, "reason": "unknown"}


def test_empty_seat_keeps_the_car_as_away_for_the_last_driver() -> None:
    idt = DriverIdentity()
    idt.on_result(GALANG, 0.0)
    idt.on_face(True, 1.0)
    assert idt.away_driver(1.0) == ""  # someone is driving
    idt.on_face(False, 10.0)  # gets out
    assert idt.away_driver(15.0) == ""  # still the current driver for the first 20 s
    assert idt.on_face(False, 31.0)  # seat empty 21 s: driver cleared
    assert idt.away_driver(31.0) == "a" * 24  # ... but the car is Galang's, "away"
    assert idt.away_driver(10.0 + 31 * 60) == ""  # after 30 min: just offline
    idt.on_face(True, 40.0)  # back in the seat: identified again, not "away"
    assert idt.away_driver(40.0) == ""


def test_an_unrecognised_face_for_30_s_is_reported_once() -> None:
    idt = DriverIdentity()
    t = 0.0
    reports = 0
    while t < 120.0:
        idt.on_face(True, t)
        if idt.should_identify(True, t):
            idt.started()
            idt.on_result(UNKNOWN, t)
        if idt.should_report_unknown(True, t):
            idt.reported_unknown()
            reports += 1
            first = t
        t += 1.0
    assert reports == 1 and 30.0 <= first <= 35.0


def test_a_registered_driver_or_a_short_unknown_moment_is_not_reported() -> None:
    idt = DriverIdentity()
    idt.on_result(UNKNOWN, 0.0)  # a bad first look ...
    idt.on_result(GALANG, 4.0)  # ... then recognised
    assert not idt.should_report_unknown(True, 60.0)
    idt2 = DriverIdentity()
    idt2.on_result(UNKNOWN, 0.0)
    idt2.on_face(False, 5.0)  # the stranger leaves after a few seconds
    idt2.on_face(False, 30.0)
    assert not idt2.should_report_unknown(False, 40.0)
