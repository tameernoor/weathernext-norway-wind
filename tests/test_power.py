import pytest

from weathernext_norway_wind.power import CUT_IN_MS, CUT_OUT_MS, RATED_MS, capacity_factor


@pytest.mark.parametrize(
    ("wind", "expected"),
    [
        (0.0, 0.0),
        (CUT_IN_MS - 0.1, 0.0),
        (CUT_IN_MS, 0.0),
        (RATED_MS, 1.0),
        (20.0, 1.0),
        (CUT_OUT_MS, 0.0),
        (30.0, 0.0),
    ],
)
def test_capacity_factor_at_curve_edges(wind, expected):
    assert capacity_factor(wind) == expected


def test_capacity_factor_rises_between_cut_in_and_rated():
    values = [capacity_factor(w) for w in (4.0, 6.0, 8.0, 10.0)]
    assert values == sorted(values)
    assert all(0.0 < v < 1.0 for v in values)
