# 实时语音输入实现规范

## 目标

将桌面端当前“录完整段 WAV，再一次性转写”的语音输入升级为端到端流式链路：

1. 用户开始讲话后，输入框持续显示 ASR 临时文本。
2. 临时文本与原有输入隔离；取消时可以恢复，停止后才提交最终文本。
3. GUI 只负责麦克风采集和展示，模型凭证、ASR 连接及协议解析仍由 nanobot gateway 负责。
4. 不支持实时协议的 ASR 保留现有批量转写降级路径。

本期不包含全局快捷键、跨应用文字注入、长时间麦克风预热、系统音频静音、用户词典学习和 LLM 润色。

## 架构

```text
ChatInput
  -> AudioWorklet (PCM16 mono, 16 kHz, 40 ms/chunk)
  -> NanobotClient JSON WebSocket
  -> WebSocketChannel
  -> WebuiVoiceStreamSession
  -> realtime ASR WebSocket
  -> partial/stable/final events
  -> ChatInput voice draft range
```

GUI 不直接连接第三方 ASR，不读取 API Key。流式语音不是 Agent turn，不写入会话历史，也不改变项目或会话运行状态。

## WebSocket 协议

### GUI 到 gateway

开始：

```json
{
  "type": "voice_stream_start",
  "stream_id": "voice_xxx",
  "sample_rate": 16000
}
```

音频：

```json
{
  "type": "voice_audio_chunk",
  "stream_id": "voice_xxx",
  "sequence": 0,
  "audio": "<base64 pcm16>",
  "duration_ms": 40
}
```

停止并获取最终结果：

```json
{
  "type": "voice_stream_stop",
  "stream_id": "voice_xxx"
}
```

取消：

```json
{
  "type": "voice_stream_cancel",
  "stream_id": "voice_xxx"
}
```

### gateway 到 GUI

```json
{"event":"voice_stream_state","stream_id":"voice_xxx","state":"listening","mode":"realtime"}
{"event":"voice_transcript_partial","stream_id":"voice_xxx","text":"帮我分析"}
{"event":"voice_transcript_stable","stream_id":"voice_xxx","text":"帮我分析青岛啤酒"}
{"event":"voice_transcript_final","stream_id":"voice_xxx","text":"帮我分析青岛啤酒 A 股"}
{"event":"voice_stream_error","stream_id":"voice_xxx","detail":"connection_interrupted","recoverable":true}
```

`stream_id` 是所有事件的隔离键。GUI 必须忽略非当前 `stream_id` 的迟到事件。`sequence` 必须单调递增；gateway 忽略重复帧，缺帧时记录诊断日志但继续处理后续音频。

## 音频采集

- `getUserMedia` 单声道。
- AudioWorklet 内完成重采样和 Float32 -> PCM16。
- 默认 16 kHz、40 ms 一帧。
- 普通录音继续启用噪声抑制；回声消除和自动增益沿用桌面端兼容配置。
- 停止时先要求 worklet flush 尾部样本，待最后一帧写入 WebSocket 发送队列后再发 `voice_stream_stop`。
- 发送热路径不等待服务端响应；客户端维护递增 sequence。

## ASR provider

gateway 新增独立的实时转写接口，不放进 Agent loop：

```python
class StreamingTranscriptionSession(Protocol):
    async def start(self) -> None: ...
    async def append_audio(self, pcm16: bytes, *, sequence: int, duration_ms: float) -> None: ...
    async def finish(self) -> str: ...
    async def cancel(self) -> None: ...
```

首期协议：

- `qwen-asr-server-vad`：Qwen3 ASR Flash Realtime。
- `stepfun-asr-server-vad`：StepFun 双向流式 ASR。桌面麦克风选择
  `stepaudio-2.5-asr` 时，上游自动使用 `stepaudio-2.5-asr-stream`；
  WebSocket 建连失败则回退原有 SSE 批量识别。
- `openai-transcription-manual`：OpenAI-compatible Realtime Transcription。
- 其他模型返回 `mode=batch`，GUI 使用现有完整 WAV 转写。

实时能力必须由 provider/model 显式解析，不能把普通 SSE 或 HTTP 文件转写伪装为 realtime。
`stepaudio-2.5-realtime` 属于双向语音通话模型，不作为输入框听写模型。

## 输入框草稿

开始录音时保存：

- 原始文本；
- `selectionStart` / `selectionEnd`；
- 被选中的原文字。

每次 partial/stable 只替换语音草稿范围：

```text
beforeSelection + voiceDraft + afterSelection
```

取消恢复原始文本和原选择区；final 将草稿转为正式输入并把光标移动到最终文本末尾。录音过程中禁止用户编辑，避免草稿范围与真实文本漂移。

状态：

- `connecting`
- `listening`
- `finalizing`
- `idle`
- `error`

终态不保留额外状态条。录音按钮使用麦克风动态图标；finalizing 使用旋转图标。

## 降级

gateway 在 start 响应中返回 `mode=batch` 时：

1. GUI 仍使用本地 PCM 录音器收集完整音频。
2. 停止后调用现有 `transcribe_audio`。
3. UI 明确显示“正在识别”，不生成虚假的 partial。

实时连接在已经产生文本后中断时，应保留最后一个 partial/stable，并允许 stop 将它作为最终结果返回。没有任何文本时才显示失败。

## 生命周期与资源清理

- 每个 WebSocket connection 最多一个活动语音 stream。
- 新 start 会先取消同一 connection 上的旧 stream。
- connection 关闭时取消 provider reader task 并关闭上游 WebSocket。
- stop/cancel 必须幂等。
- 单帧、累计录音时长和 base64 解码均受限于 transcription 配置。
- 日志记录 stream_id、provider、model、sequence、音频毫秒数和首个 partial 延迟，不记录音频内容与 API Key。

## 测试

gateway：

- start/chunk/stop/cancel 路由。
- 未配置、批量降级、乱序/重复 chunk。
- partial/stable/final 转换。
- 连接断开清理和 stop 幂等。

GUI：

- AudioWorklet PCM16 分帧和 flush。
- NanobotClient 事件按 stream_id 分发。
- partial 替换同一草稿范围，cancel 恢复原文，final 正式提交。
- batch 模式继续调用原有 `transcribeAudio`。
- 组件卸载和会话切换会取消当前 stream。
