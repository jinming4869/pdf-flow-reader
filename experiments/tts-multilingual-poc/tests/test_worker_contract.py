import json
import subprocess
import sys


def test_worker_health_and_structured_error_without_loading_models():
    process = subprocess.Popen(
        [sys.executable, "-m", "tts_poc.worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert process.stdin is not None
    assert process.stdout is not None

    ready = json.loads(process.stdout.readline())
    assert ready["type"] == "ready"
    assert ready["protocolVersion"] == 1

    process.stdin.write(json.dumps({"type": "health", "requestId": "health-1"}) + "\n")
    process.stdin.flush()
    health = json.loads(process.stdout.readline())
    assert health == {
        "type": "result",
        "requestId": "health-1",
        "result": {"ok": True, "activeLanguage": None, "protocolVersion": 1},
    }

    process.stdin.write(
        json.dumps(
            {
                "type": "synthesize",
                "requestId": "bad-language",
                "payload": {"language": "en", "text": "hello", "outputPath": "ignored.wav"},
            }
        )
        + "\n"
    )
    process.stdin.flush()
    error = json.loads(process.stdout.readline())
    assert error["type"] == "error"
    assert error["requestId"] == "bad-language"
    assert error["error"]["name"] == "ValueError"

    process.stdin.write(json.dumps({"type": "shutdown", "requestId": "shutdown-1"}) + "\n")
    process.stdin.flush()
    shutdown = json.loads(process.stdout.readline())
    assert shutdown["result"] == {"ok": True}
    assert process.wait(timeout=10) == 0
