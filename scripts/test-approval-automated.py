#!/usr/bin/env python3
"""
Automated test for approval response flow.
Monitors agent logs, captures approval request, and sends simulated response.
"""

import subprocess
import time
import re
import json
import requests
import signal
import sys

def find_approval_request(log_file):
    """Extract approval request details from log file."""
    try:
        with open(log_file, 'r') as f:
            lines = f.readlines()

        # Find the last approval request
        for line in reversed(lines):
            if 'Sent approval request' in line:
                # Extract request ID and task ID
                # Format: [ws-client] Sent approval request {requestId} for task {taskId}
                match = re.search(r'Sent approval request (\S+) for task (\S+)', line)
                if match:
                    return {
                        'requestId': match.group(1),
                        'taskId': match.group(2),
                        'line': line.strip()
                    }

        return None
    except FileNotFoundError:
        return None

def find_machine_id(log_file):
    """Extract machine ID from agent config in log file."""
    try:
        with open(log_file, 'r') as f:
            content = f.read()

        # Find machineId in the agent config JSON
        match = re.search(r'"machineId":\s*"([^"]+)"', content)
        if match:
            return match.group(1)

        return None
    except FileNotFoundError:
        return None

def send_approval_response(task_id, machine_id, request_id, answer):
    """Send approval response to the server."""
    url = 'http://localhost:3001/api/dispatch/approval'
    payload = {
        'taskId': task_id,
        'machineId': machine_id,
        'requestId': request_id,
        'answered': True,
        'answer': answer
    }

    try:
        response = requests.post(url, json=payload, timeout=5)
        return response.json()
    except Exception as e:
        return {'error': str(e)}

def check_agent_received_response(log_file, request_id):
    """Check if agent received the approval response."""
    try:
        with open(log_file, 'r') as f:
            content = f.read()

        # Look for response handling
        if f'Received approval response for {request_id}' in content:
            return True

        return False
    except FileNotFoundError:
        return False

def main():
    log_file = '/tmp/agent-approval-test.log'

    print("=== Automated Approval Response Test ===\n")

    # Clean up
    subprocess.run(['pkill', '-f', 'nexus-agent'], stderr=subprocess.DEVNULL)
    time.sleep(2)
    subprocess.run(['rm', '-f', log_file])

    # Start agent runner
    print("Starting agent runner...")
    agent_process = subprocess.Popen(
        ['npx', 'tsx', 'src/index.ts', 'start'],
        cwd='/Users/xf2217/Repos/nexus/packages/agent-runner',
        stdout=open(log_file, 'w'),
        stderr=subprocess.STDOUT,
        env={**subprocess.os.environ, 'NEXUS_LOG_LEVEL': 'debug'}
    )

    print(f"Agent PID: {agent_process.pid}")
    print("Waiting for agent to connect (10 seconds)...")
    time.sleep(10)

    # Monitor for approval request
    print("\nMonitoring for approval request (timeout: 120 seconds)...")
    print("Waiting for agent to call AskUserQuestion...\n")

    start_time = time.time()
    approval_found = False

    while time.time() - start_time < 120:
        approval = find_approval_request(log_file)

        if approval:
            approval_found = True
            print("✅ APPROVAL REQUEST DETECTED!")
            print(f"   Request ID: {approval['requestId']}")
            print(f"   Task ID: {approval['taskId']}")

            # Get machine ID
            machine_id = find_machine_id(log_file)
            if not machine_id:
                print("❌ Could not find machine ID in logs")
                break

            print(f"   Machine ID: {machine_id}")

            # Wait a moment to ensure request is fully processed
            time.sleep(2)

            # Send simulated response
            print("\n=== SIMULATING USER RESPONSE ===")
            answer = "All features"
            print(f"Sending answer: '{answer}'")

            response = send_approval_response(
                approval['taskId'],
                machine_id,
                approval['requestId'],
                answer
            )

            print(f"Server response: {json.dumps(response, indent=2)}")

            # Wait for agent to process the response
            print("\n=== Checking if agent received response ===")
            time.sleep(5)

            if check_agent_received_response(log_file, approval['requestId']):
                print("✅ Agent received approval response!")
            else:
                print("⚠️  Agent did not log receiving the response")

            # Check for updatedInput (agent continuing with answer)
            with open(log_file, 'r') as f:
                log_content = f.read()

            if 'updatedInput' in log_content or 'allow' in log_content:
                print("✅ Agent appears to have continued with the answer!")
            else:
                print("⚠️  Could not confirm agent continued with answer")

            break

        time.sleep(1)

    if not approval_found:
        print("❌ No approval request detected within timeout period")
        print("Check if agent is running and task was dispatched")

    # Show relevant log lines
    print("\n=== Relevant Agent Logs ===")
    try:
        with open(log_file, 'r') as f:
            for line in f:
                if any(keyword in line.lower() for keyword in
                       ['approval', 'askuserquestion', 'updatedinput', 'answer']):
                    print(line.rstrip())
    except FileNotFoundError:
        print("Log file not found")

    # Cleanup
    print(f"\n=== Cleaning up ===")
    agent_process.terminate()
    try:
        agent_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        agent_process.kill()

    print(f"Test complete. Full logs at: {log_file}")

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user")
        sys.exit(1)
