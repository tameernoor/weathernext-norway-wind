-- The newest forecast run. Reads only the partition column, over the last
-- six hours of runs (new runs arrive hourly).
SELECT MAX(init_time) AS init_time
FROM `{table}`
WHERE init_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 6 HOUR)
