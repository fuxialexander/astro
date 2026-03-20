# Compute Execution Guide

## Direct (local shell)
Run commands directly in the working directory using standard CLI tools.

## Session Liveness
Your session has an activity timeout. After starting any long-running job, poll its status every 60 seconds. Never go silent — keep producing tool calls to stay alive.
