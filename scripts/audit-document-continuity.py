"""Offline diagnostic for ordinary document conversations, not a model benchmark.

Run with the nanobot environment:
  ../nanobot/venv/bin/python scripts/audit-document-continuity.py

All documents and sessions are synthetic and written to a new temporary directory.
The provider is scripted: this measures prompt construction, compaction, and the
runtime's response to a wrong-version tool call, NOT how often a real model errs.
Assertions characterize the audited behavior; these are not acceptance tests.
"""

from __future__ import annotations

import argparse
import asyncio
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from unittest.mock import AsyncMock, MagicMock, patch


def save_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


async def audit(output: Path) -> dict:
    from docx import Document
    from loguru import logger

    from nanobot.agent.context import ContextBuilder, build_immediate_prior_turn_evidence
    from nanobot.agent.loop import AgentLoop
    from nanobot.agent.memory import Consolidator
    from nanobot.agent.tools.docx import CreateDocxTool
    from nanobot.bus.events import InboundMessage
    from nanobot.bus.queue import MessageBus
    from nanobot.config.schema import _resolve_tool_config_refs
    from nanobot.providers.base import GenerationSettings, LLMResponse, ToolCallRequest
    from nanobot.session.manager import SessionManager
    from nanobot.storage.state import StateStore

    logger.remove()
    _resolve_tool_config_refs()
    checks = {}
    project = output / "project"
    project.mkdir()
    builder = ContextBuilder(project)

    def tool_turn(request, name, arguments, result, final="已完成，文件已生成。"):
        return [
            {"role": "user", "content": request},
            {"role": "assistant", "content": "", "tool_calls": [
                ToolCallRequest(id="fixture-call", name=name, arguments=arguments).to_openai_tool_call(),
            ]},
            {"role": "tool", "tool_call_id": "fixture-call", "name": name,
             "content": json.dumps(result, ensure_ascii=False)},
            {"role": "assistant", "content": final},
        ]

    history = tool_turn(
        "请以报告_v1.md为基础，预算维持100万元。", "create_docx",
        {"source_path": "报告_v1.md", "output_path": "报告_v1.docx"},
        {"files": [{"path": str(project / "报告_v1.docx")}]},
    )
    current = "改为基于最新的报告_v2.docx，预算150万元，保留新增审批条款。"
    messages = builder.build_messages(history=history, current_message=current, channel="websocket")
    tail = messages[-1]["content"]
    assert messages[-1]["role"] == "user" and tail.startswith(current)
    assert tail.index("预算维持100万元") > tail.index(current)
    checks["current_request_and_old_evidence"] = {
        "current_request_preserved": True,
        "old_request_repeated_after_current_request": True,
        "old_tool_arguments_repeated_after_current_request": "报告_v1.md" in tail,
        "interpretation": "Prompt interference risk; not proof of real-model noncompliance.",
    }
    save_json(output / "01-prompt.json", messages)

    busy_history = [{"role": "user", "content": "完成本轮文档修订"}]
    for index in range(21):
        arguments = {"path": "报告_v1.md"} if index < 20 else {
            "source_path": "报告_v2.md", "output_path": "报告_v2.docx",
        }
        name = "read_file" if index < 20 else "create_docx"
        busy_history.extend(tool_turn("unused", name, arguments, "完成")[1:3])
        busy_history[-2]["tool_calls"][0]["id"] = f"call-{index}"
        busy_history[-1]["tool_call_id"] = f"call-{index}"
    busy_history.append({"role": "assistant", "content": "文档修订已完成。"})
    evidence = build_immediate_prior_turn_evidence(busy_history)
    assert "报告_v1.md" in evidence and "报告_v2" not in evidence
    assert "报告_v2.docx" in json.dumps(busy_history, ensure_ascii=False)
    checks["prior_turn_evidence_truncation"] = {
        "tool_calls_in_previous_turn": 21,
        "latest_output_missing_from_tail_evidence": True,
        "old_version_present_in_tail_evidence": True,
        "latest_output_still_in_full_history": True,
    }
    (output / "02-prior-turn-evidence.txt").write_text(evidence, encoding="utf-8")

    marker = "预算150万元；后续以报告_v2.docx为基准；保留新增审批条款。"
    for mode in ("replay_window", "idle"):
        root = output / mode
        root.mkdir()
        sessions = SessionManager(root)
        session = sessions.get_or_create(f"websocket:audit-{mode}")
        session.add_message("user", marker)
        session.add_message("assistant", "已确认，后续遵循这些要求。")
        for index in range(60 if mode == "replay_window" else 5):
            session.add_message("user", f"措辞讨论{index}，这一轮不修改文件。")
            session.add_message("assistant", f"措辞讨论{index}结束。")
        sessions.save(session)
        provider = MagicMock()
        provider.generation = GenerationSettings(max_tokens=512)
        provider.estimate_prompt_tokens.return_value = (100, "audit-fixed-counter")
        captured = []

        async def lossless_summary(*, messages, **kwargs):
            captured.append(deepcopy(messages))
            # Deliberately preserve EVERY input character, excluding model quality
            # as an explanation for a missing earlier requirement.
            return LLMResponse(content=messages[-1]["content"], tool_calls=[])

        provider.chat_with_retry = lossless_summary
        consolidator = Consolidator(
            store=None, provider=provider, model="offline-audit", sessions=sessions,
            context_window_tokens=200_000, build_messages=ContextBuilder(root).build_messages,
            get_tool_definitions=lambda: [], max_completion_tokens=512,
        )

        async def compact():
            if mode == "idle":
                await consolidator.compact_idle_session(session.key, max_suffix=8)
            else:
                await consolidator.maybe_consolidate_by_tokens(session, replay_max_messages=120)

        await compact()
        session = sessions.get_or_create(session.key)
        first_summary = session.metadata["_last_summary"]["text"]
        assert marker in first_summary
        for index in range(1 if mode == "replay_window" else 2):
            session.add_message("user", f"继续讨论排版{index}，不修改文件。")
            session.add_message("assistant", "排版讨论结束。")
        sessions.save(session)
        await compact()
        session = sessions.get_or_create(session.key)
        second_summary = session.metadata["_last_summary"]["text"]
        runtime = ContextBuilder(root).build_messages(
            history=session.get_history(), current_message="继续润色最新版。",
            session_summary=second_summary,
        )
        assert len(captured) == 2
        assert marker not in json.dumps(captured[1], ensure_ascii=False)
        assert marker not in json.dumps(runtime, ensure_ascii=False)
        checks[f"successive_{mode}_compaction"] = {
            "first_summary_preserves_approved_version_and_constraints": True,
            "second_summary_input_omits_previous_summary": True,
            "next_runtime_prompt_loses_approved_version_and_constraints": True,
        }
        save_json(output / f"03-{mode}-compaction.json", {
            "summary_requests": captured, "first_summary": first_summary,
            "second_summary": second_summary, "next_runtime_prompt": runtime,
        })

    v1 = "# 项目报告\n\n预算：100万元。\n\n普通条款。\n"
    v2 = "# 项目报告\n\n预算：150万元。\n\n新增审批条款：付款前须书面审批。\n"
    stale_v3 = v1.replace("项目报告", "年度项目报告")
    docx_tool = CreateDocxTool(workspace=project, allowed_dir=project)
    state = StateStore(project / ".nanobot" / "state.sqlite", default_workspace=project)
    project_record = state.ensure_project(project)
    session_key = "websocket:audit-word-versions"
    state.bind_session(session_key, project_record.id)
    version_results = []
    for number, body in ((1, v1), (2, v2)):
        (project / f"报告_v{number}.md").write_text(body, encoding="utf-8")
        result = await docx_tool.execute(source_path=f"报告_v{number}.md")
        assert isinstance(result, dict), result
        version_results.append(result)
        state.register_artifact(session_key, project / f"报告_v{number}.docx")
    with sqlite3.connect(state.path) as connection:
        links = connection.execute(
            "SELECT relative_path, supersedes_artifact_id FROM artifacts ORDER BY relative_path"
        ).fetchall()
    assert len(links) == 2 and all(parent is None for _, parent in links)
    checks["different_filename_versions"] = {
        "registered_word_artifacts": [path for path, _ in links],
        "v2_supersedes_v1": False,
        "interpretation": "Only same-path revisions are linked automatically.",
    }

    current = (
        "只在最新的报告_v2.docx对应源稿上，把标题改为“年度项目报告”，"
        "输出报告_v3.docx；预算150万元和新增审批条款必须保留，禁止退回v1。"
    )
    requests = []
    steps = [
        {"id": "revise", "title": "最新报告标题修订", "status": "running"},
        {"id": "deliver", "title": "修订版报告交付", "status": "pending"},
    ]

    def call(name, arguments):
        return LLMResponse(content="继续处理文档。", tool_calls=[
            ToolCallRequest(id=f"audit-{name}", name=name, arguments=arguments),
        ], finish_reason="tool_calls")

    responses = [
        call("update_task_progress", {"steps": steps}),
        call("read_file", {"path": "报告_v1.md"}),
        call("write_file", {"path": "报告_v3.md", "content": stale_v3}),
        call("create_docx", {"source_path": "报告_v3.md"}),
        call("update_task_progress", {"steps": [{**step, "status": "completed"} for step in steps]}),
        LLMResponse(content="已完成报告_v3.docx。", tool_calls=[]),
    ]

    async def scripted_wrong_version(*, messages, **kwargs):
        requests.append(deepcopy(messages))
        assert responses, "Unexpected extra provider call"
        return responses.pop(0)

    provider = MagicMock()
    provider.get_default_model.return_value = "offline-audit"
    provider.generation = GenerationSettings(max_tokens=4096)
    provider.estimate_prompt_tokens.return_value = (100, "audit-fixed-counter")
    provider.chat_with_retry = scripted_wrong_version
    provider.chat_stream_with_retry = scripted_wrong_version
    loop = AgentLoop(
        bus=MessageBus(), provider=provider, workspace=project,
        model="offline-audit", restrict_to_workspace=True,
    )
    loop.consolidator.maybe_consolidate_by_tokens = AsyncMock(return_value=None)
    session = loop.sessions.get_or_create(session_key)
    session.metadata["project_id"] = project_record.id
    for number, result in enumerate(version_results, start=1):
        turn = tool_turn(
            f"生成报告_v{number}.docx，预算为{100 if number == 1 else 150}万元。",
            "create_docx", {"source_path": f"报告_v{number}.md"}, result,
        )
        turn[1]["tool_calls"][0]["id"] = f"version-{number}"
        turn[2]["tool_call_id"] = f"version-{number}"
        session.messages.extend(turn)
    loop.sessions.save(session)
    try:
        outbound = await loop._process_message(InboundMessage(
            channel="websocket", sender_id="audit-user", chat_id="audit-word-versions",
            content=current, metadata={"webui": True},
        ))
    finally:
        await loop.close_mcp()
    assert outbound is not None
    assert current in json.dumps(requests[0], ensure_ascii=False)
    generated = project / "报告_v3.docx"
    text = "\n".join(p.text for p in Document(generated).paragraphs)
    assert "年度项目报告" in text and "100万元" in text
    assert "150万元" not in text and "新增审批条款" not in text
    assert generated.resolve() in {Path(path).resolve() for path in outbound.media}, outbound.media
    checks["wrong_version_fault_injection"] = {
        "latest_instruction_reaches_provider": True,
        "runtime_accepts_stale_source_tool_calls": True,
        "word_file_delivered": str(generated),
        "title_change_present": True,
        "budget_regressed_from_150_to_100": True,
        "approved_clause_lost": True,
        "interpretation": "Scripted model error; proves missing runtime containment, not model error frequency.",
    }
    save_json(output / "04-wrong-version-provider-requests.json", requests)
    (output / "04-generated-word-text.txt").write_text(text, encoding="utf-8")
    return {"output_dir": str(output), "live_model_used": False, "checks": checks}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nanobot-root", type=Path, default=Path(__file__).resolve().parents[2] / "nanobot")
    args = parser.parse_args()
    sys.path.insert(0, str(args.nanobot_root.resolve()))
    output = Path(tempfile.mkdtemp(prefix="tpcowork-document-continuity-")).resolve()
    # Prevent legacy-session migration from the user's actual runtime directory.
    with patch("nanobot.session.manager.get_legacy_sessions_dir", return_value=output / "legacy"):
        result = asyncio.run(audit(output))
    save_json(output / "results.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
