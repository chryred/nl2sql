#!/bin/bash

#docker compose ps

#docker logs nl2sql-mcp --tail=50

#docker compose restart nl2sql-mcp

docker compose down && docker compose build --no-cache && docker compose up -d

#docker image prune
