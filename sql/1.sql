# find the latest values for all datapoints
SELECT  datetime(timestamp / 1000, 'unixepoch', 'localtime') AS timestamp,
        id AS _id,
        value
FROM    vals
WHERE   timestamp = (
            SELECT MAX(timestamp)
            FROM   vals
            WHERE  id = _id
        )