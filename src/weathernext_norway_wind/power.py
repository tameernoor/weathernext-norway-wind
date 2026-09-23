"""A generic wind turbine power curve.

Real turbines each have their own curve. This one is deliberately simple so the
map can say "expected output" instead of "metres per second".
"""

CUT_IN_MS = 3.0  # below this the turbine does not turn
RATED_MS = 12.0  # at and above this it produces full power
CUT_OUT_MS = 25.0  # at and above this it shuts down to protect itself


def capacity_factor(wind_speed_ms: float) -> float:
    """Share of rated power (0 to 1) produced at a given hub-height wind speed."""
    if wind_speed_ms < CUT_IN_MS or wind_speed_ms >= CUT_OUT_MS:
        return 0.0
    if wind_speed_ms >= RATED_MS:
        return 1.0
    # Power grows with the cube of wind speed between cut-in and rated.
    span = RATED_MS**3 - CUT_IN_MS**3
    return (wind_speed_ms**3 - CUT_IN_MS**3) / span
