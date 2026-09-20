"""Smoke-test Agent Python commands using only the packaged runtime and OS utilities."""

import asyncio
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from nanobot.agent.tools.shell import ExecTool
from nanobot.config.loader import set_config_path
from nanobot.config.schema import PackageSourcesConfig
from nanobot.runtime.dependencies import (
    configure_package_sources,
    workspace_python_path,
)


async def check(workspace: Path, *, workspace_python: bool) -> None:
    configure_package_sources(PackageSourcesConfig(workspace_python=workspace_python))
    expected_python = str(workspace_python_path(workspace)) if workspace_python else sys.executable
    tool = ExecTool(working_dir=str(workspace))
    # A newline selects PowerShell in ExecTool; single-line commands use cmd.exe.
    shells = ("cmd", "powershell") if os.name == "nt" else ("unix",)
    for shell in shells:
        for launcher in ("python", "python3", "pip", "pip3"):
            if launcher.startswith("pip"):
                command = f"{launcher} --version"
                expected = subprocess.check_output(
                    [expected_python, "-m", "pip", "--version"], text=True,
                ).strip()
            else:
                command = f'{launcher} -c "import sys; print(sys.executable)"'
                expected = expected_python
            if shell == "powershell":
                command += "\nexit $LASTEXITCODE"
            result = await tool.execute(command, login=False)
            if "Exit code: 0" not in result or expected not in result:
                raise RuntimeError(f"{shell}/{launcher}, workspace_python={workspace_python}: {result}")
        # Launcher wrappers must propagate failures as well as successful output.
        command = 'python3 -c "raise SystemExit(7)"'
        if shell == "powershell":
            command += "\nexit $LASTEXITCODE"
        result = await tool.execute(command, login=False)
        if "Exit code: 7" not in result:
            raise RuntimeError(f"{shell}: Python exit code was lost: {result}")
    print(f"Agent Python commands passed: workspace_python={workspace_python}")


async def main() -> None:
    os.environ["NANOBOT_DESKTOP_GATEWAY"] = "1"
    if os.name == "nt":
        system = Path(os.environ.get("SYSTEMROOT", r"C:\Windows")) / "System32"
        os.environ["PATH"] = os.pathsep.join([
            str(system), str(system / "WindowsPowerShell" / "v1.0"),
        ])
    else:
        os.environ["PATH"] = "/usr/bin:/bin"
    with tempfile.TemporaryDirectory(prefix="tpcowork-python-check-") as directory:
        root = Path(directory).resolve()
        set_config_path(root / "runtime with spaces" / "config.json")
        workspace = root / "workspace with spaces"
        workspace.mkdir()
        await check(workspace, workspace_python=False)
        await check(workspace, workspace_python=True)


if __name__ == "__main__":
    asyncio.run(main())
