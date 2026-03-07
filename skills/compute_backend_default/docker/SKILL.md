---
name: docker-default
version: "1.0.0"
description: "Default Docker execution skills: exec, cp, build, volume mounts, container management."
category: tools
tags: [docker, container]
allowedTools: [Bash, Read, Write, Glob, Grep]
---

# Docker Execution Essentials

## Container Execution
- Run command: `docker exec -it <container> <command>`
- Start container: `docker run -d --name <name> <image>`
- Interactive shell: `docker exec -it <container> /bin/bash`
- Run with GPU: `docker run --gpus all <image>`

## File Operations
- Copy to container: `docker cp <local-path> <container>:<path>`
- Copy from container: `docker cp <container>:<path> <local-path>`
- Mount volume: `docker run -v <host-path>:<container-path> <image>`

## Container Management
- List running: `docker ps`
- List all: `docker ps -a`
- Stop container: `docker stop <container>`
- Remove container: `docker rm <container>`
- View logs: `docker logs <container> --tail=100`
- Follow logs: `docker logs -f <container>`

## Resource Limits
- Limit memory: `docker run --memory=16g <image>`
- Limit CPUs: `docker run --cpus=4 <image>`
- Combined: `docker run --gpus all --memory=32g --cpus=8 <image>`

## Networking & Environment
- Map port: `docker run -p <host-port>:<container-port> <image>`
- Set env variable: `docker run -e KEY=VALUE <image>`
- Use env file: `docker run --env-file .env <image>`

## Image Management
- Build image: `docker build -t <tag> .`
- List images: `docker images`
- Pull image: `docker pull <image>`

## Session Liveness (IMPORTANT)

Your session has an activity timeout. If you stop producing tool calls, the system assumes you are dead and will kill your session. Follow these rules to stay alive:

1. **Poll every 60 seconds** — After starting a long-running container, check its status with `docker ps` or `docker logs --tail=20 <container>` at least once per minute.
2. **Never use `docker logs -f` as sole monitoring** — Blocking follow commands keep the process alive but may not reset the activity timer. Instead, use periodic `docker logs --tail=20 <container>` calls.
3. **Never go silent** — Do NOT start a container and then wait without making tool calls. Keep polling to stay alive.
4. **Report progress** — Between polls, tell the user what the container is doing (e.g., "Container training-run has been running for 10 minutes, logs show step 500/1000").
