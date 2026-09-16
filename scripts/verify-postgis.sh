#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for jiwar_db..."
for i in $(seq 1 60); do
  docker exec jiwar_db pg_isready -U jiwar -d jiwar_dev -q 2>/dev/null && break
  sleep 1
  if [ "$i" -eq 60 ]; then echo "FAIL: database never became ready"; exit 1; fi
done

docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "CREATE EXTENSION IF NOT EXISTS postgis;" >/dev/null

VERSION=$(docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc "SELECT postgis_version();")
echo "PostGIS: $VERSION"

# Two points in Algiers about 4.9 km apart. geography => metres.
METRES=$(docker exec jiwar_db psql -U jiwar -d jiwar_dev -tAc \
  "SELECT round(ST_Distance('POINT(3.06 36.75)'::geography,'POINT(3.10 36.78)'::geography));")
echo "Distance: ${METRES} m"

if [ "$METRES" -lt 4000 ] || [ "$METRES" -gt 6000 ]; then
  echo "FAIL: expected ~4900 m. Got ${METRES}. If this is a tiny number like 0 or 5, the column is geometry (degrees) rather than geography (metres)."
  exit 1
fi

echo "PASS: PostGIS is working and geography returns metres."
