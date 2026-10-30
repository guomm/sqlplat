"""Exercise PID handling without starting the real API or touching its database."""
import os
import signal
from pathlib import Path
import shutil
import subprocess
import sys
import time

import pytest


@pytest.fixture
def script_project(tmp_path):
    root = tmp_path / "project"
    (root / "scripts").mkdir(parents=True)
    (root / ".venv/bin").mkdir(parents=True)
    (root / "bin").mkdir()
    source = Path(__file__).parents[2]
    for name in ("start-api.sh", "stop-api.sh"):
        shutil.copy(source / "scripts" / name, root / "scripts" / name)
    python = root / ".venv/bin/uvicorn"
    python.write_text(f"#!{sys.executable}\n" + '''import os, sys, time
from pathlib import Path
if os.environ.get("FAKE_START_FAIL"):
    print("address already in use", flush=True)
    sys.exit(1)
Path("child.pid").write_text(str(os.getpid()))
print("Uvicorn running on http://127.0.0.1:8001", flush=True)
while True:
    time.sleep(.1)
''')
    python.chmod(0o755)
    uv = root / "bin/uv"
    uv.write_text(f"#!{sys.executable}\n" + '''import subprocess, sys
if sys.argv[1] == "sync":
    sys.exit(0)
child = subprocess.Popen([".venv/bin/uvicorn", "app.main:create_app"])
child.wait()
''')
    uv.chmod(0o755)
    env = {**os.environ, "API_PORT": "59991", "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"]}
    yield root, env
    child_file = root / "child.pid"
    if child_file.exists():
        pid = int(child_file.read_text())
        command = subprocess.run(["ps", "-p", str(pid), "-o", "args="], capture_output=True, text=True).stdout
        if ".venv/bin/uvicorn" in command:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass


def run_script(root, env, name):
    return subprocess.run(["bash", str(root / "scripts" / name)], cwd=root.parent,
                          env=env, capture_output=True, text=True, timeout=40)


def test_start_records_api_pid_and_stop_works_outside_project(script_project):
    root, env = script_project
    try:
        started = run_script(root, env, "start-api.sh")
        assert started.returncode == 0, started.stdout + started.stderr
        assert (root / "uvicorn.pid").read_text().strip() == (root / "child.pid").read_text()
        duplicate = run_script(root, env, "start-api.sh")
        assert duplicate.returncode == 1
    finally:
        stopped = run_script(root, env, "stop-api.sh")
    assert stopped.returncode == 0, stopped.stdout + stopped.stderr
    assert not (root / "uvicorn.pid").exists()


def test_failed_start_is_reported_and_pid_removed(script_project):
    root, env = script_project
    failed = run_script(root, {**env, "FAKE_START_FAIL": "1"}, "start-api.sh")
    assert failed.returncode == 1
    assert "address already in use" in failed.stdout
    assert not (root / "uvicorn.pid").exists()


def test_stop_handles_legacy_uv_parent_and_api_child(script_project):
    root, env = script_project
    parent = subprocess.Popen([str(root / "bin/uv"), "run", "uvicorn", "app.main:create_app"],
                              cwd=root, env=env, stdout=subprocess.DEVNULL)
    (root / "uvicorn.pid").write_text(str(parent.pid))
    try:
        for _ in range(100):
            if (root / "child.pid").exists():
                break
            time.sleep(.02)
        assert (root / "child.pid").exists()
        stopped = run_script(root, env, "stop-api.sh")
        assert stopped.returncode == 0, stopped.stdout + stopped.stderr
        assert parent.wait(timeout=5) is not None
    finally:
        run_script(root, env, "stop-api.sh")
        if parent.poll() is None:
            parent.terminate()
            parent.wait(timeout=5)


def test_stop_refuses_unrelated_pid(script_project):
    root, env = script_project
    (root / "uvicorn.pid").write_text(str(os.getpid()))
    stopped = run_script(root, env, "stop-api.sh")
    assert stopped.returncode == 1
    assert "refusing" in stopped.stdout
    assert (root / "uvicorn.pid").exists()
