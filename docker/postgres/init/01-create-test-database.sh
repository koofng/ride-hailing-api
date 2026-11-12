#!/bin/sh
# Runs once, when the Postgres data volume is first created.
# Creates a separate database for the e2e tests so they never touch dev data.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE ride_hailing_test OWNER "$POSTGRES_USER";
EOSQL
