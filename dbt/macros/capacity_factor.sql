{#- Share of rated power (0 to 1) at a hub-height wind speed.
    The same generic curve as src/weathernext_norway_wind/power.py:
    cut-in 3 m/s, rated 12 m/s, cut-out 25 m/s, cubic in between. -#}
{% macro capacity_factor(wind) %}
  case
    when {{ wind }} < 3 or {{ wind }} >= 25 then 0.0
    when {{ wind }} >= 12 then 1.0
    else (pow({{ wind }}, 3) - pow(3, 3)) / (pow(12, 3) - pow(3, 3))
  end
{% endmacro %}
